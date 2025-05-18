import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { RewardSplitter, RewardSplitterShareHolder, Vault } from '../../generated/schema'
import { convertSharesToAssets, getUpdateStateCalls } from './vault'
import { loadV2Pool } from './v2pool'
import { createOrLoadAllocator } from './allocator'
import {
  REWARD_SPLITTER_FACTORY_V1,
  REWARD_SPLITTER_FACTORY_V2,
  REWARD_SPLITTER_FACTORY_V3,
} from '../helpers/constants'
import { chunkedMulticall, encodeContractCall } from '../helpers/utils'

const syncRewardsCallSelector = '0x72c0c211'
const rewardsOfSelector = '0x479ba7ae'

export function loadRewardSplitterShareHolder(
  shareHolderAddress: Address,
  rewardSplitter: Address,
): RewardSplitterShareHolder | null {
  const rewardSplitterShareHolderId = `${rewardSplitter.toHex()}-${shareHolderAddress.toHex()}`
  return RewardSplitterShareHolder.load(rewardSplitterShareHolderId)
}

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

export function updateRewardSplitters(vault: Vault): void {
  if (vault.isGenesis && !loadV2Pool()!.migrated) {
    // wait for the migration
    return
  }

  const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()
  const updateStateCalls = getUpdateStateCalls(vault)

  let rewardSplitter: RewardSplitter
  const syncRewardsCall = Bytes.fromHexString(syncRewardsCallSelector)
  for (let i = 0; i < rewardSplitters.length; i++) {
    rewardSplitter = rewardSplitters[i]
    const shareHolders: Array<RewardSplitterShareHolder> = rewardSplitter.shareHolders.load()
    if (shareHolders.length == 0) {
      continue
    }
    let calls: Array<ethereum.Value> = [encodeContractCall(Address.fromString(rewardSplitter.id), syncRewardsCall)]
    for (let j = 0; j < shareHolders.length; j++) {
      calls.push(
        encodeContractCall(
          Address.fromString(rewardSplitter.id),
          _getRewardsOfCall(Address.fromBytes(shareHolders[j].address)),
        ),
      )
    }

    let result = chunkedMulticall(updateStateCalls, calls)
    // remove the first element (syncRewardsCall result)
    result = result.slice(1)

    let shareHolder: RewardSplitterShareHolder
    let earnedVaultAssetsBefore: BigInt
    for (let j = 0; j < shareHolders.length; j++) {
      shareHolder = shareHolders[j]
      earnedVaultAssetsBefore = shareHolder.earnedVaultAssets
      shareHolder.earnedVaultShares = ethereum.decode('uint256', result[j]!)!.toBigInt()
      shareHolder.earnedVaultAssets = convertSharesToAssets(vault, shareHolder.earnedVaultShares)
      shareHolder.save()

      const allocator = createOrLoadAllocator(Address.fromBytes(shareHolder.address), Address.fromString(vault.id))
      allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(
        shareHolder.earnedVaultAssets.minus(earnedVaultAssetsBefore),
      )
      allocator.save()
    }
  }
}

function _getRewardsOfCall(shareHolder: Address): Bytes {
  const encodedRewardsOfArgs = ethereum.encode(ethereum.Value.fromAddress(shareHolder))
  return Bytes.fromHexString(rewardsOfSelector).concat(encodedRewardsOfArgs as Bytes)
}

export function getRewardSplitterVersion(factoryAddress: Address): BigInt | null {
  if (factoryAddress == Address.fromString(REWARD_SPLITTER_FACTORY_V1)) {
    return BigInt.fromI32(1)
  }
  if (factoryAddress == Address.fromString(REWARD_SPLITTER_FACTORY_V2)) {
    return BigInt.fromI32(2)
  }
  if (factoryAddress == Address.fromString(REWARD_SPLITTER_FACTORY_V3)) {
    return BigInt.fromI32(3)
  }
  return null
}
