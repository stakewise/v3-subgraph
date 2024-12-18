import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, ExitRequestSnapshot, Vault } from '../../generated/schema'
import { Vault as VaultContract } from '../../generated/Keeper/Vault'
import { loadV2Pool } from './v2pool'
import { convertSharesToAssets, getUpdateStateCall, getVaultApy, loadVault } from './vault'

const secondsInDay = '86400'
const getExitQueueIndexSelector = '0x60d60e6e'
const calculateExitedAssetsSelector = '0x76b58b90'

export function loadExitRequest(vault: Address, positionTicket: BigInt): ExitRequest | null {
  const exitRequestId = `${vault.toHex()}-${positionTicket.toString()}`
  return ExitRequest.load(exitRequestId)
}

export function updateExitRequests(vault: Vault, timestamp: BigInt): void {
  if (vault.isGenesis) {
    const v2Pool = loadV2Pool()!
    if (!v2Pool.migrated) {
      // wait for the migration
      return
    }
  }

  const vaultAddress = Address.fromString(vault.id)
  const vaultContract = VaultContract.bind(vaultAddress)
  const exitRequests: Array<ExitRequest> = vault.exitRequests.load()
  const updateStateCall: Bytes | null = getUpdateStateCall(vault)

  let calls: Array<Bytes> = []
  if (updateStateCall) {
    calls.push(updateStateCall)
  }
  let exitRequest: ExitRequest
  const pendingExitRequests: Array<ExitRequest> = []
  for (let i = 0; i < exitRequests.length; i++) {
    exitRequest = exitRequests[i]
    if (!exitRequest.isClaimed) {
      pendingExitRequests.push(exitRequest)
      calls.push(getExitQueueIndexCall(exitRequest.positionTicket))
    }
  }

  let result = vaultContract.multicall(calls)
  if (updateStateCall) {
    // remove first call result
    result = result.slice(1)
  }

  for (let i = 0; i < result.length; i++) {
    const index = ethereum.decode('int256', result[i])!.toBigInt()
    exitRequest = pendingExitRequests[i]
    if (index.lt(BigInt.zero())) {
      exitRequest.exitQueueIndex = null
    } else {
      exitRequest.exitQueueIndex = index
    }
  }

  calls = []
  if (updateStateCall) {
    calls.push(updateStateCall)
  }
  const maxUint255 = BigInt.fromI32(2).pow(255).minus(BigInt.fromI32(1))
  for (let i = 0; i < pendingExitRequests.length; i++) {
    exitRequest = pendingExitRequests[i]
    const exitQueueIndex = exitRequest.exitQueueIndex !== null ? exitRequest.exitQueueIndex! : maxUint255
    calls.push(
      getCalculateExitedAssetsCall(
        Address.fromBytes(exitRequest.receiver),
        exitRequest.positionTicket,
        exitRequest.timestamp,
        exitQueueIndex,
      ),
    )
  }

  result = vaultContract.multicall(calls)
  if (updateStateCall) {
    // remove first call result
    result = result.slice(1)
  }

  const one = BigInt.fromI32(1)
  for (let i = 0; i < result.length; i++) {
    exitRequest = pendingExitRequests[i]
    let decodedResult = ethereum.decode('(uint256,uint256,uint256)', result[i])!.toTuple()
    const leftTickets = decodedResult[0].toBigInt()
    const exitedAssets = decodedResult[2].toBigInt()
    const totalAssetsBefore = exitRequest.totalAssets
    if (leftTickets.gt(one)) {
      exitRequest.totalAssets = exitRequest.isV2Position
        ? leftTickets.times(vault.exitingAssets).div(vault.exitingTickets).plus(exitedAssets)
        : convertSharesToAssets(vault, leftTickets).plus(exitedAssets)
    } else {
      exitRequest.totalAssets = exitedAssets
    }
    exitRequest.exitedAssets = exitedAssets

    if (!exitedAssets.isZero()) {
      exitRequest.isClaimable = exitRequest.timestamp.plus(BigInt.fromString(secondsInDay)).lt(timestamp)
    } else {
      exitRequest.isClaimable = false
    }
    exitRequest.save()

    snapshotExitRequest(exitRequest, exitRequest.totalAssets.minus(totalAssetsBefore), timestamp)
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

export function snapshotExitRequest(exitRequest: ExitRequest, earnedAssets: BigInt, timestamp: BigInt): void {
  let apy: BigDecimal = BigDecimal.zero()
  if (!exitRequest.isV2Position && exitRequest.exitedAssets.lt(exitRequest.totalAssets)) {
    const vault = loadVault(Address.fromString(exitRequest.vault))!
    const vaultApy = getVaultApy(vault, true)
    apy = vaultApy.minus(
      vaultApy.times(exitRequest.exitedAssets.toBigDecimal()).div(exitRequest.totalAssets.toBigDecimal()),
    )
  }
  const exitRequestSnapshot = new ExitRequestSnapshot(timestamp.toString())
  exitRequestSnapshot.timestamp = timestamp.toI64()
  exitRequestSnapshot.exitRequest = exitRequest.id
  exitRequestSnapshot.earnedAssets = exitRequest.isClaimed ? BigInt.zero() : earnedAssets
  exitRequestSnapshot.totalAssets = exitRequest.isClaimed ? BigInt.zero() : exitRequest.totalAssets
  exitRequestSnapshot.apy = apy
  exitRequestSnapshot.save()
}
