import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  Distributor,
  OsToken,
  OsTokenConfig,
  RewardSplitter,
  RewardSplitterShareHolder,
  Vault,
} from '../../generated/schema'
import { RewardSplitter as RewardSplitterContract } from '../../generated/Keeper/RewardSplitter'
import { convertSharesToAssets } from './vault'
import { createOrLoadV2Pool } from './v2pool'
import { createOrLoadAllocator, snapshotAllocator } from './allocator'

const vaultUpdateStateSelector = '0x79c702ad'
const syncRewardsCallSelector = '0x72c0c211'
const rewardsOfSelector = '0x479ba7ae'

export function createOrLoadRewardSplitterShareHolder(
  shareHolderAddress: Address,
  rewardSplitter: Address,
  vault: string,
): RewardSplitterShareHolder {
  const rewardSplitterShareHolderId = `${rewardSplitter.toHex()}-${shareHolderAddress.toHex()}`

  let rewardSplitterShareHolder = RewardSplitterShareHolder.load(rewardSplitterShareHolderId)

  if (rewardSplitterShareHolder === null) {
    rewardSplitterShareHolder = new RewardSplitterShareHolder(rewardSplitterShareHolderId)
    rewardSplitterShareHolder.shares = BigInt.zero()
    rewardSplitterShareHolder.address = shareHolderAddress
    rewardSplitterShareHolder.rewardSplitter = rewardSplitter.toHex()
    rewardSplitterShareHolder.vault = vault
    rewardSplitterShareHolder.earnedVaultShares = BigInt.zero()
    rewardSplitterShareHolder.earnedVaultAssets = BigInt.zero()
    rewardSplitterShareHolder.save()
  }

  return rewardSplitterShareHolder
}

export function updateRewardSplitters(
  osToken: OsToken,
  distributor: Distributor,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  timestamp: BigInt,
): void {
  if (vault.isGenesis) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      // wait for the migration
      return
    }
  }

  const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()
  const updateStateCall: Bytes | null = _getVaultUpdateStateCall(vault)

  let rewardSplitter: RewardSplitter
  const syncRewardsCall = Bytes.fromHexString(syncRewardsCallSelector)
  for (let i = 0; i < rewardSplitters.length; i++) {
    rewardSplitter = rewardSplitters[i]
    const shareHolders: Array<RewardSplitterShareHolder> = rewardSplitter.shareHolders.load()
    let calls: Array<Bytes> = []
    if (updateStateCall) {
      calls.push(updateStateCall)
    }
    calls.push(syncRewardsCall)
    for (let j = 0; j < shareHolders.length; j++) {
      calls.push(_getRewardsOfCall(Address.fromBytes(shareHolders[j].address)))
    }

    const rewardSplitterContract = RewardSplitterContract.bind(Address.fromString(rewardSplitter.id))
    let callResult: Array<Bytes> = rewardSplitterContract.multicall(calls)
    callResult = callResult.slice(updateStateCall ? 2 : 1)

    let shareHolder: RewardSplitterShareHolder
    let earnedVaultAssetsBefore: BigInt
    for (let j = 0; j < shareHolders.length; j++) {
      shareHolder = shareHolders[j]
      earnedVaultAssetsBefore = shareHolder.earnedVaultAssets
      shareHolder.earnedVaultShares = ethereum.decode('uint256', callResult[j])!.toBigInt()
      shareHolder.earnedVaultAssets = convertSharesToAssets(vault, shareHolder.earnedVaultShares)
      shareHolder.save()
      snapshotRewardSplitterShareHolder(
        osToken,
        distributor,
        vault,
        osTokenConfig,
        shareHolder,
        shareHolder.earnedVaultAssets.minus(earnedVaultAssetsBefore),
        timestamp,
      )
    }
  }
}

export function snapshotRewardSplitterShareHolder(
  osToken: OsToken,
  distributor: Distributor,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  shareHolder: RewardSplitterShareHolder,
  earnedAssets: BigInt,
  timestamp: BigInt,
): void {
  const allocator = createOrLoadAllocator(Address.fromBytes(shareHolder.address), Address.fromString(vault.id))
  snapshotAllocator(osToken, osTokenConfig, vault, distributor, allocator, earnedAssets, timestamp)
}

function _getVaultUpdateStateCall(vault: Vault): Bytes | null {
  if (
    vault.rewardsRoot === null ||
    vault.proofReward === null ||
    vault.proofUnlockedMevReward === null ||
    vault.proof === null
  ) {
    return null
  }
  const updateStateArray: Array<ethereum.Value> = [
    ethereum.Value.fromFixedBytes(vault.rewardsRoot!),
    ethereum.Value.fromSignedBigInt(vault.proofReward!),
    ethereum.Value.fromUnsignedBigInt(vault.proofUnlockedMevReward!),
    ethereum.Value.fromFixedBytesArray(vault.proof!.map<Bytes>((p: string) => Bytes.fromHexString(p))),
  ]
  // Encode the tuple
  const encodedUpdateStateArgs = ethereum.encode(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(updateStateArray)))
  return Bytes.fromHexString(vaultUpdateStateSelector).concat(encodedUpdateStateArgs as Bytes)
}

function _getRewardsOfCall(shareHolder: Address): Bytes {
  const encodedRewardsOfArgs = ethereum.encode(ethereum.Value.fromAddress(shareHolder))
  return Bytes.fromHexString(rewardsOfSelector).concat(encodedRewardsOfArgs as Bytes)
}
