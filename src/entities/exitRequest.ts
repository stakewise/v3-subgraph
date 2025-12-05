import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, Network, Vault } from '../../generated/schema'
import { loadV2Pool } from './v2pool'
import { convertSharesToAssets, getUpdateStateCall } from './vault'
import { loadAllocator } from './allocator'
import { chunkedMulticall, encodeContractCall, isFailedRewardsUpdate } from '../helpers/utils'
import { isGnosisNetwork } from './network'

const getExitQueueIndexSelector = '0x60d60e6e'
const calculateExitedAssetsSelector = '0x76b58b90'

export function loadExitRequest(vault: Address, positionTicket: BigInt): ExitRequest | null {
  const exitRequestId = `${vault.toHex()}-${positionTicket.toString()}`
  return ExitRequest.load(exitRequestId)
}

export function updateClaimableExitRequests(vault: Vault, timestamp: BigInt): void {
  let exitRequest: ExitRequest
  const exitRequests: Array<ExitRequest> = vault.exitRequests.load()
  const isGnosis = isGnosisNetwork()
  for (let i = 0; i < exitRequests.length; i++) {
    exitRequest = exitRequests[i]
    if (exitRequest.exitedAssets.gt(BigInt.zero()) && !exitRequest.isClaimed && !exitRequest.isClaimable) {
      const isClaimable = _isExitRequestClaimable(vault, exitRequest, timestamp, isGnosis)
      if (isClaimable) {
        exitRequest.isClaimable = isClaimable
        exitRequest.save()
      }
    }
  }
}

export function updateExitRequests(network: Network, vault: Vault, timestamp: BigInt): void {
  // If vault is in "genesis" mode, we need to wait for legacy migration
  if (vault.isGenesis && !loadV2Pool()!.migrated) {
    return
  }
  if (!vault.isCollateralized) {
    // If vault is not collateralized, there are no exit requests to process
    return
  }
  if (isFailedRewardsUpdate(vault.rewardsRoot)) {
    return
  }

  const vaultAddr = Address.fromString(vault.id)

  const exitRequests: Array<ExitRequest> = vault.exitRequests.load()
  const updateStateCalls = getUpdateStateCall(vault)

  // ─────────────────────────────────────────────────────────────────────
  // STAGE 1: Query exitQueueIndex for all pending exit requests
  // ─────────────────────────────────────────────────────────────────────

  // Collect all the calls for the first multicall batch
  let allCallsStage1: Array<ethereum.Value> = []
  let pendingExitRequests: Array<ExitRequest> = []
  for (let i = 0; i < exitRequests.length; i++) {
    let exitRequest = exitRequests[i]
    if (!exitRequest.isClaimed) {
      pendingExitRequests.push(exitRequest)
      allCallsStage1.push(encodeContractCall(vaultAddr, getExitQueueIndexCall(exitRequest.positionTicket)))
    }
  }
  if (pendingExitRequests.length == 0) {
    return
  }

  // Execute in chunks of size 100
  let stage1Results = chunkedMulticall(updateStateCalls, allCallsStage1, true, 100)

  // Parse exitQueueIndex results
  for (let i = 0; i < stage1Results.length; i++) {
    let exitRequest = pendingExitRequests[i]
    let index = ethereum.decode('int256', stage1Results[i]!)!.toBigInt()
    if (index.lt(BigInt.zero())) {
      exitRequest.exitQueueIndex = null
    } else {
      exitRequest.exitQueueIndex = index
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // STAGE 2: Query exited assets for all pending exit requests
  // ─────────────────────────────────────────────────────────────────────

  // Build calls for calculating exited assets
  let allCallsStage2: Array<ethereum.Value> = []
  const maxUint255 = BigInt.fromI32(2).pow(255).minus(BigInt.fromI32(1))
  for (let i = 0; i < pendingExitRequests.length; i++) {
    let exitRequest = pendingExitRequests[i]
    let exitQueueIndex = exitRequest.exitQueueIndex !== null ? exitRequest.exitQueueIndex! : maxUint255
    allCallsStage2.push(
      encodeContractCall(
        vaultAddr,
        getCalculateExitedAssetsCall(
          Address.fromBytes(exitRequest.receiver),
          exitRequest.positionTicket,
          exitRequest.timestamp,
          exitQueueIndex,
        ),
      ),
    )
  }

  // Execute in chunks of size 100
  let stage2Results = chunkedMulticall(updateStateCalls, allCallsStage2, true, 100)

  // Parse and update each exitRequest
  const one = BigInt.fromI32(1)
  const isGnosis = isGnosisNetwork()
  for (let i = 0; i < stage2Results.length; i++) {
    let exitRequest = pendingExitRequests[i]
    let decodedResult = ethereum.decode('(uint256,uint256,uint256)', stage2Results[i]!)!.toTuple()

    let leftTickets = decodedResult[0].toBigInt()
    let exitedAssets = decodedResult[2].toBigInt()
    if (leftTickets.isZero() && exitedAssets.isZero()) {
      // position was claimed in the current block, skip
      continue
    }
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

    exitRequest.isClaimable = _isExitRequestClaimable(vault, exitRequest, timestamp, isGnosis)
    exitRequest.save()

    const totalAssetsDelta = exitRequest.totalAssets.minus(totalAssetsBefore)
    if (totalAssetsDelta.isZero()) {
      continue
    }

    const allocator = loadAllocator(Address.fromBytes(exitRequest.receiver), vaultAddr)
    // if total assets are zero, it means the vault must apply the fix to the exit queue introduced in v4 vaults
    if (allocator && exitRequest.totalAssets.gt(BigInt.zero())) {
      allocator._periodStakeEarnedAssets = allocator._periodStakeEarnedAssets.plus(totalAssetsDelta)
      allocator.exitingAssets = allocator.exitingAssets.plus(totalAssetsDelta)
      allocator.save()
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

function _isExitRequestClaimable(
  vault: Vault,
  exitRequest: ExitRequest,
  timestamp: BigInt,
  isGnosis: boolean,
): boolean {
  // If there are some exited assets, check if they are claimable
  if (exitRequest.exitedAssets.isZero()) {
    return false
  }

  const minDuration = _getExitQueueMinDelay(vault, isGnosis)
  return exitRequest.timestamp.plus(minDuration).lt(timestamp)
}

function _getExitQueueMinDelay(vault: Vault, isGnosis: boolean): BigInt {
  const beforePectraDelay = BigInt.fromI32(86400) // 24 hours
  const afterPectraDelay = BigInt.fromI32(54000) // 15 hours
  const latestPrivateVaultDelay = BigInt.zero()
  if (isGnosis) {
    if (vault.isGenesis) {
      return vault.version.gt(BigInt.fromString('3')) ? afterPectraDelay : beforePectraDelay // 15 or 24 hours
    } else if (vault.isPrivate) {
      return vault.version.gt(BigInt.fromString('2')) ? latestPrivateVaultDelay : beforePectraDelay // 0 or 24 hours
    }
    return vault.version.gt(BigInt.fromString('2')) ? afterPectraDelay : beforePectraDelay // 15 or 24 hours
  }

  if (vault.isPrivate) {
    return vault.version.gt(BigInt.fromString('4')) ? latestPrivateVaultDelay : beforePectraDelay // 0 or 24 hours
  }
  return vault.version.gt(BigInt.fromString('4')) ? afterPectraDelay : beforePectraDelay // 15 or 24 hours
}
