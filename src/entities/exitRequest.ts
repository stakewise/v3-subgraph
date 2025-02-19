import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, Network, Vault } from '../../generated/schema'
import { loadV2Pool } from './v2pool'
import { convertSharesToAssets, getUpdateStateCall } from './vault'
import { loadAllocator } from './allocator'
import { getOsTokenHolderVault, loadOsTokenHolder } from './osTokenHolder'
import { chunkedVaultMulticall } from '../helpers/utils'

const secondsInDay = '86400'
const getExitQueueIndexSelector = '0x60d60e6e'
const calculateExitedAssetsSelector = '0x76b58b90'

export function loadExitRequest(vault: Address, positionTicket: BigInt): ExitRequest | null {
  const exitRequestId = `${vault.toHex()}-${positionTicket.toString()}`
  return ExitRequest.load(exitRequestId)
}

export function updateExitRequests(network: Network, vault: Vault, timestamp: BigInt): void {
  // If vault is in "genesis" mode, we need to wait for legacy migration
  if (vault.isGenesis && !loadV2Pool()!.migrated) {
    return
  }
  const vaultAddr = Address.fromString(vault.id)

  const exitRequests: Array<ExitRequest> = vault.exitRequests.load()
  const updateStateCall: Bytes | null = getUpdateStateCall(vault)

  // ─────────────────────────────────────────────────────────────────────
  // STAGE 1: Query exitQueueIndex for all pending exit requests
  // ─────────────────────────────────────────────────────────────────────

  // Collect all the calls for the first multicall batch
  let allCallsStage1: Array<Bytes> = []
  if (updateStateCall) {
    allCallsStage1.push(updateStateCall)
  }

  let pendingExitRequests: Array<ExitRequest> = []
  for (let i = 0; i < exitRequests.length; i++) {
    let exitRequest = exitRequests[i]
    if (!exitRequest.isClaimed) {
      pendingExitRequests.push(exitRequest)
      allCallsStage1.push(getExitQueueIndexCall(exitRequest.positionTicket))
    }
  }
  if (pendingExitRequests.length == 0) {
    return
  }

  // Execute in chunks of size 10
  let stage1Results: Array<Bytes> = chunkedVaultMulticall(vaultAddr, allCallsStage1, 100)

  // If we had an updateStateCall, remove its result from the front
  // so that the remainder of the results map cleanly to `pendingExitRequests`.
  if (updateStateCall) {
    stage1Results = stage1Results.slice(1) // remove first result
  }

  // Parse exitQueueIndex results
  for (let i = 0; i < stage1Results.length; i++) {
    let exitRequest = pendingExitRequests[i]
    let index = ethereum.decode('int256', stage1Results[i])!.toBigInt()
    if (index.lt(BigInt.zero())) {
      exitRequest.exitQueueIndex = null
    } else {
      exitRequest.exitQueueIndex = index
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // STAGE 2: Query exited assets for all pending exit requests
  // ─────────────────────────────────────────────────────────────────────

  // Build calls for the second multicall batch
  let allCallsStage2: Array<Bytes> = []
  if (updateStateCall) {
    allCallsStage2.push(updateStateCall)
  }

  const maxUint255 = BigInt.fromI32(2).pow(255).minus(BigInt.fromI32(1))
  for (let i = 0; i < pendingExitRequests.length; i++) {
    let exitRequest = pendingExitRequests[i]
    let exitQueueIndex = exitRequest.exitQueueIndex !== null ? exitRequest.exitQueueIndex! : maxUint255

    allCallsStage2.push(
      getCalculateExitedAssetsCall(
        Address.fromBytes(exitRequest.receiver),
        exitRequest.positionTicket,
        exitRequest.timestamp,
        exitQueueIndex,
      ),
    )
  }

  // Execute in chunks of size 10
  let stage2Results: Array<Bytes> = chunkedVaultMulticall(vaultAddr, allCallsStage2, 100)

  // If we had an updateStateCall, remove its result from the front again
  if (updateStateCall) {
    stage2Results = stage2Results.slice(1)
  }

  // Parse and update each exitRequest
  const one = BigInt.fromI32(1)
  for (let i = 0; i < stage2Results.length; i++) {
    let exitRequest = pendingExitRequests[i]
    let decodedResult = ethereum.decode('(uint256,uint256,uint256)', stage2Results[i])!.toTuple()

    let leftTickets = decodedResult[0].toBigInt()
    let exitedAssets = decodedResult[2].toBigInt()
    let totalAssetsBefore = exitRequest.totalAssets

    // If multiple tickets remain, recalculate total assets. Otherwise, set total to exitedAssets.
    if (leftTickets.gt(one)) {
      exitRequest.totalAssets = exitRequest.isV2Position
        ? leftTickets.times(vault.exitingAssets).div(vault.exitingTickets).plus(exitedAssets)
        : convertSharesToAssets(vault, leftTickets).plus(exitedAssets)
    } else {
      exitRequest.totalAssets = exitedAssets
    }
    exitRequest.exitedAssets = exitedAssets

    // If there are some exited assets, check if they are claimable
    if (!exitedAssets.isZero()) {
      exitRequest.isClaimable = exitRequest.timestamp.plus(BigInt.fromString(secondsInDay)).lt(timestamp)
    } else {
      exitRequest.isClaimable = false
    }

    exitRequest.save()

    const earnedAssets = exitRequest.totalAssets.minus(totalAssetsBefore)
    if (earnedAssets.isZero()) {
      continue
    }

    const allocator = loadAllocator(Address.fromBytes(exitRequest.receiver), vaultAddr)
    // if total assets are zero, it means the vault must apply the fix to the exit queue introduced in v4 vaults
    if (allocator && exitRequest.totalAssets.gt(BigInt.zero())) {
      allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(earnedAssets)
      allocator.save()
    }

    const osTokenHolder = loadOsTokenHolder(Address.fromBytes(exitRequest.receiver))
    if (!osTokenHolder || exitRequest.totalAssets.le(BigInt.zero())) {
      continue
    }
    const osTokenVault = getOsTokenHolderVault(network, osTokenHolder)
    if (osTokenVault && osTokenVault.equals(vaultAddr)) {
      osTokenHolder._periodEarnedAssets = osTokenHolder._periodEarnedAssets.plus(earnedAssets)
      osTokenHolder.save()
    }
  }
}

function getExitQueueIndexCall(positionTicket: BigInt): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(positionTicket))
  return Bytes.fromHexString(getExitQueueIndexSelector).concat(encodedArgs as Bytes)
}

function getCalculateExitedAssetsCall(
  receiver: Address,
  positionTicket: BigInt,
  timestamp: BigInt,
  exitQueueIndex: BigInt,
): Bytes {
  return Bytes.fromHexString(calculateExitedAssetsSelector)
    .concat(ethereum.encode(ethereum.Value.fromAddress(receiver))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(positionTicket))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(timestamp))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(exitQueueIndex))!)
}
