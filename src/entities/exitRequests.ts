import { ExitRequestSnapshot, ExitRequest, Vault } from '../../generated/schema'
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Vault as VaultContract } from '../../generated/BlockHandlers/Vault'
import { convertSharesToAssets, getUpdateStateCall } from './vaults'

const secondsInDay = '86400'
const getExitQueueIndexSelector = '0x60d60e6e'
const calculateExitedAssetsSelector = '0x76b58b90'

export function updateExitRequests(vault: Vault, block: ethereum.Block): void {
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

  let exitRequestsWithIndex: Array<ExitRequest> = []
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
      exitRequest.isClaimable = false
      exitRequest.save()
    } else {
      exitRequest.exitQueueIndex = index
      exitRequestsWithIndex.push(exitRequest)
    }
  }

  calls = []
  if (updateStateCall !== null) {
    calls.push(updateStateCall)
  }
  for (let i = 0; i < exitRequestsWithIndex.length; i++) {
    exitRequest = exitRequestsWithIndex[i]
    calls.push(
      getCalculateExitedAssetsCall(
        Address.fromBytes(exitRequest.receiver),
        exitRequest.positionTicket,
        exitRequest.timestamp,
        exitRequest.exitQueueIndex as BigInt,
      ),
    )
  }

  result = vaultContract.multicall(calls)
  if (updateStateCall !== null) {
    // remove first call result
    result = result.slice(1)
  }

  for (let i = 0; i < result.length; i++) {
    exitRequest = exitRequestsWithIndex[i]
    let decodedResult = ethereum.decode('(uint256,uint256,uint256)', result[i])!.toTuple()
    const leftTickets = decodedResult[0].toBigInt()
    const exitedAssets = decodedResult[2].toBigInt()
    const totalAssetsBefore = exitRequest.totalAssets
    if (!leftTickets.isZero()) {
      exitRequest.totalAssets = exitRequest.isV2Position
        ? leftTickets.times(vault.exitingAssets).div(vault.exitingTickets).plus(exitedAssets)
        : convertSharesToAssets(vault, leftTickets).plus(exitedAssets)
    }
    exitRequest.exitedAssets = exitedAssets
    exitRequest.isClaimable = exitRequest.timestamp.plus(BigInt.fromString(secondsInDay)).gt(block.timestamp)

    if (
      vault.rewardsTimestamp !== null &&
      exitRequest.lastSnapshotTimestamp.notEqual(vault.rewardsTimestamp as BigInt)
    ) {
      exitRequest.lastSnapshotTimestamp = vault.rewardsTimestamp as BigInt
      snapshotExitRequest(
        exitRequest,
        exitRequest.totalAssets.minus(totalAssetsBefore),
        vault.rewardsTimestamp as BigInt,
      )
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
  const exitRequestSnapshot = new ExitRequestSnapshot('1')
  exitRequestSnapshot.timestamp = rewardsTimestamp.toI64()
  exitRequestSnapshot.exitRequest = exitRequest.id
  exitRequestSnapshot.earnedAssets = earnedAssets
  exitRequestSnapshot.totalAssets = exitRequest.totalAssets
  exitRequestSnapshot.save()
}
