import { ExitRequestSnapshot, ExitRequest, Vault } from '../../generated/schema'
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Vault as VaultContract } from '../../generated/Keeper/Vault'
import { convertSharesToAssets, getUpdateStateCall } from './vaults'
import { GENESIS_VAULT } from '../helpers/constants'
import { createOrLoadV2Pool } from './v2pool'

const secondsInDay = '86400'
const getExitQueueIndexSelector = '0x60d60e6e'
const calculateExitedAssetsSelector = '0x76b58b90'

export function updateExitRequests(vault: Vault, block: ethereum.Block): void {
  if (vault.rewardsTimestamp === null) {
    return
  }
  if (Address.fromString(vault.id).equals(GENESIS_VAULT)) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      // wait for the migration
      return
    }
  }

  const vaultAddress = Address.fromString(vault.id)
  const vaultContract = VaultContract.bind(vaultAddress)
  const exitRequests: Array<ExitRequest> = vault.exitRequests.load()
  let updateStateCall: Bytes | null = null
  if (
    vault.rewardsRoot !== null &&
    vault.proofReward !== null &&
    vault.proofUnlockedMevReward !== null &&
    vault.proof !== null &&
    vault.proof!.length > 0
  ) {
    updateStateCall = getUpdateStateCall(
      vault.rewardsRoot as Bytes,
      vault.proofReward as BigInt,
      vault.proofUnlockedMevReward as BigInt,
      (vault.proof as Array<string>).map<Bytes>((p: string) => Bytes.fromHexString(p)),
    )
  }

  let calls: Array<Bytes> = []
  if (updateStateCall !== null) {
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
  if (updateStateCall !== null) {
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
  if (updateStateCall !== null) {
    calls.push(updateStateCall)
  }
  const maxUint255 = BigInt.fromI32(2).pow(255).minus(BigInt.fromI32(1))
  for (let i = 0; i < exitRequests.length; i++) {
    exitRequest = exitRequests[i]
    const exitQueueIndex = exitRequest.exitQueueIndex !== null ? (exitRequest.exitQueueIndex as BigInt) : maxUint255
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
  if (updateStateCall !== null) {
    // remove first call result
    result = result.slice(1)
  }

  const one = BigInt.fromI32(1)
  const vaultUpdateTimestamp = vault.rewardsTimestamp as BigInt
  for (let i = 0; i < result.length; i++) {
    exitRequest = exitRequests[i]
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
      exitRequest.isClaimable = exitRequest.timestamp.plus(BigInt.fromString(secondsInDay)).lt(block.timestamp)
    } else {
      exitRequest.isClaimable = false
    }

    if (exitRequest.lastSnapshotTimestamp.notEqual(vaultUpdateTimestamp)) {
      exitRequest.lastSnapshotTimestamp = vaultUpdateTimestamp
      snapshotExitRequest(exitRequest, exitRequest.totalAssets.minus(totalAssetsBefore), vaultUpdateTimestamp)
    }
    exitRequest.save()
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

export function snapshotExitRequest(exitRequest: ExitRequest, earnedAssets: BigInt, rewardsTimestamp: BigInt): void {
  const exitRequestSnapshot = new ExitRequestSnapshot(rewardsTimestamp.toString())
  exitRequestSnapshot.timestamp = rewardsTimestamp.toI64()
  exitRequestSnapshot.exitRequest = exitRequest.id
  exitRequestSnapshot.earnedAssets = earnedAssets
  exitRequestSnapshot.totalAssets = exitRequest.totalAssets
  exitRequestSnapshot.save()
}
