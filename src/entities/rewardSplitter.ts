import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  RewardSplitter,
  RewardSplitterShareHolder,
  RewardSplitterShareHolderSnapshot,
  Vault,
} from '../../generated/schema'
import { RewardSplitter as RewardSplitterContract } from '../../generated/BlockHandlers/RewardSplitter'
import { convertSharesToAssets } from './vaults'

const vaultUpdateStateSelector = '0x79c702ad'
const syncRewardsCallSelector = '0x72c0c211'
const rewardsOfSelector = '0x479ba7ae'

export function createOrLoadRewardSplitterShareHolder(
  shareHolderAddress: Address,
  rewardSplitter: Address,
): RewardSplitterShareHolder {
  const rewardSplitterShareHolderId = `${rewardSplitter.toHex()}-${shareHolderAddress.toHex()}`

  let rewardSplitterShareHolder = RewardSplitterShareHolder.load(rewardSplitterShareHolderId)

  if (rewardSplitterShareHolder === null) {
    rewardSplitterShareHolder = new RewardSplitterShareHolder(rewardSplitterShareHolderId)
    rewardSplitterShareHolder.shares = BigInt.zero()
    rewardSplitterShareHolder.address = shareHolderAddress
    rewardSplitterShareHolder.rewardSplitter = rewardSplitter.toHex()
    rewardSplitterShareHolder.earnedVaultShares = BigInt.zero()
    rewardSplitterShareHolder.earnedVaultAssets = BigInt.zero()
    rewardSplitterShareHolder.save()
  }

  return rewardSplitterShareHolder
}

export function updateRewardSplitters(vault: Vault): void {
  if (vault.rewardsTimestamp === null) {
    return
  }

  const lastRewardsTimestamp = vault.rewardsTimestamp as BigInt
  const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()
  let updateStateCall: Bytes | null = null
  if (
    vault.rewardsRoot !== null &&
    vault.proofReward !== null &&
    vault.proofUnlockedMevReward !== null &&
    vault.proof !== null &&
    vault.proof!.length > 0
  ) {
    updateStateCall = _getVaultUpdateStateCall(
      vault.rewardsRoot as Bytes,
      vault.proofReward as BigInt,
      vault.proofUnlockedMevReward as BigInt,
      (vault.proof as Array<string>).map<Bytes>((p: string) => Bytes.fromHexString(p)),
    )
  }

  let rewardSplitter: RewardSplitter
  const outdatedRewardSplitters: Array<RewardSplitter> = []
  for (let i = 0; i < rewardSplitters.length; i++) {
    rewardSplitter = rewardSplitters[i]
    if (rewardSplitter.lastSnapshotTimestamp.notEqual(lastRewardsTimestamp)) {
      rewardSplitter.lastSnapshotTimestamp = lastRewardsTimestamp
      rewardSplitter.save()
      outdatedRewardSplitters.push(rewardSplitter)
    }
  }

  const syncRewardsCall = Bytes.fromHexString(syncRewardsCallSelector)
  for (let i = 0; i < outdatedRewardSplitters.length; i++) {
    rewardSplitter = outdatedRewardSplitters[i]
    const shareHolders: Array<RewardSplitterShareHolder> = rewardSplitter.shareHolders.load()
    let calls: Array<Bytes> = []
    if (updateStateCall !== null) {
      calls.push(updateStateCall)
    }
    calls.push(syncRewardsCall)
    for (let j = 0; j < shareHolders.length; j++) {
      calls.push(_getRewardsOfCall(Address.fromBytes(shareHolders[j].address)))
    }

    const rewardSplitterContract = RewardSplitterContract.bind(Address.fromString(rewardSplitter.id))
    let callResult: Array<Bytes> = rewardSplitterContract.multicall(calls)
    callResult = callResult.slice(updateStateCall !== null ? 2 : 1)

    let shareHolder: RewardSplitterShareHolder
    let earnedVaultAssetsBefore: BigInt
    for (let j = 0; j < shareHolders.length; j++) {
      shareHolder = shareHolders[j]
      earnedVaultAssetsBefore = shareHolder.earnedVaultAssets
      shareHolder.earnedVaultShares = ethereum.decode('uint256', callResult[j])!.toBigInt()
      shareHolder.earnedVaultAssets = convertSharesToAssets(vault, shareHolder.earnedVaultShares)
      shareHolder.save()
      snapshotRewardSplitterShareHolder(
        shareHolder,
        shareHolder.earnedVaultAssets.minus(earnedVaultAssetsBefore),
        lastRewardsTimestamp,
      )
    }
  }
}

function _getVaultUpdateStateCall(
  rewardsRoot: Bytes,
  reward: BigInt,
  unlockedMevReward: BigInt,
  proof: Array<Bytes>,
): Bytes {
  const updateStateArray: Array<ethereum.Value> = [
    ethereum.Value.fromFixedBytes(rewardsRoot),
    ethereum.Value.fromSignedBigInt(reward),
    ethereum.Value.fromUnsignedBigInt(unlockedMevReward),
    ethereum.Value.fromFixedBytesArray(proof),
  ]
  // Encode the tuple
  const encodedUpdateStateArgs = ethereum.encode(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(updateStateArray)))
  return Bytes.fromHexString(vaultUpdateStateSelector).concat(encodedUpdateStateArgs as Bytes)
}

function _getRewardsOfCall(shareHolder: Address): Bytes {
  const encodedRewardsOfArgs = ethereum.encode(ethereum.Value.fromAddress(shareHolder))
  return Bytes.fromHexString(rewardsOfSelector).concat(encodedRewardsOfArgs as Bytes)
}

export function snapshotRewardSplitterShareHolder(
  shareHolder: RewardSplitterShareHolder,
  earnedAssets: BigInt,
  rewardsTimestamp: BigInt,
): void {
  const snapshot = new RewardSplitterShareHolderSnapshot('1')
  snapshot.timestamp = rewardsTimestamp.toI64()
  snapshot.rewardSpliterShareHolder = shareHolder.id
  snapshot.earnedAssets = earnedAssets
  snapshot.totalAssets = shareHolder.earnedVaultAssets
  snapshot.save()
}
