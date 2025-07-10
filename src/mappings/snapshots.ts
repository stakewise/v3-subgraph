import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  LeverageStrategyPosition,
  OsToken,
  OsTokenHolder,
  RewardSplitter,
  Vault,
} from '../../generated/schema'
import { convertAssetsToOsTokenShares, loadOsToken, snapshotOsToken } from '../entities/osToken'
import { snapshotAllocator } from '../entities/allocator'
import { loadNetwork } from '../entities/network'
import { loadVault, snapshotVault } from '../entities/vault'
import { loadRewardSplitterShareHolder } from '../entities/rewardSplitter'
import { loadDistributor } from '../entities/merkleDistributor'
import { snapshotOsTokenHolder } from '../entities/osTokenHolder'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'

const secondsInDay = 86400
const extraSecondsGap = 30

export function syncSnapshots(block: ethereum.Block): void {
  const newTimestamp = block.timestamp
  const newSnapshotsCount = newTimestamp.plus(BigInt.fromI32(extraSecondsGap)).div(BigInt.fromI32(secondsInDay))

  const snapshotsCheckpoint = createOrLoadCheckpoint(CheckpointType.SNAPSHOTS)
  const prevSnapshotsCount = snapshotsCheckpoint.timestamp
    .plus(BigInt.fromI32(extraSecondsGap))
    .div(BigInt.fromI32(secondsInDay))
  if (newSnapshotsCount.le(prevSnapshotsCount)) {
    return
  }

  const network = loadNetwork()
  const osToken = loadOsToken()
  const distributor = loadDistributor()

  if (!network || !osToken || !distributor) {
    log.warning('[SyncSnapshots] OsToken or Network or Distributor not found', [])
    return
  }

  if (prevSnapshotsCount.isZero()) {
    // skip first snapshot
    snapshotsCheckpoint.timestamp = newTimestamp
    snapshotsCheckpoint.save()
    return
  }

  // snapshot OsToken
  const duration = newTimestamp.minus(snapshotsCheckpoint.timestamp)
  snapshotOsToken(osToken, newTimestamp)
  osToken._periodEarnedAssets = BigInt.zero()
  osToken.save()

  // snapshot OsToken holders
  let osTokenHolder: OsTokenHolder
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    const osTokenHolderSnapshot = snapshotOsTokenHolder(network, osToken, osTokenHolder, duration, newTimestamp)
    osTokenHolder.totalEarnedAssets = osTokenHolder.totalEarnedAssets.plus(osTokenHolderSnapshot.earnedAssets)
    osTokenHolder._periodEarnedAssets = BigInt.zero()
    osTokenHolder.save()
  }

  let vault: Vault
  const vaultIds = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    // snapshot vault
    vault = loadVault(Address.fromString(vaultIds[i]))!
    if (!vault.isCollateralized) {
      continue
    }

    snapshotVault(vault, distributor, osToken, newTimestamp)
    vault._periodEarnedAssets = BigInt.zero()
    vault.save()

    const allocators: Array<Allocator> = vault.allocators.load()
    const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()
    const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
    for (let j = 0; j < allocators.length; j++) {
      const allocator = allocators[j]
      const allocatorAddress = Address.fromBytes(allocator.address)

      // get boost OsToken shares if boost exists
      let boostedOsTokenShares = BigInt.zero()
      if (vault.isOsTokenEnabled) {
        boostedOsTokenShares = _getUserBoostedOsTokenShares(osToken, allocatorAddress, leveragePositions)
      }

      // get assets from the reward splitters
      let rewardSplitterAssets = _getRewardSplitterAssets(allocatorAddress, rewardSplitters)

      const allocatorSnapshot = snapshotAllocator(
        osToken,
        allocator,
        boostedOsTokenShares,
        rewardSplitterAssets,
        duration,
        newTimestamp,
      )
      allocator.totalEarnedAssets = allocator.totalEarnedAssets.plus(allocatorSnapshot.earnedAssets)
      allocator._periodBoostEarnedAssets = BigInt.zero()
      allocator._periodBoostEarnedOsTokenShares = BigInt.zero()
      allocator._periodStakeEarnedAssets = BigInt.zero()
      allocator._periodExtraEarnedAssets = BigInt.zero()
      allocator._periodOsTokenFeeShares = BigInt.zero()
      allocator.save()
    }
  }

  snapshotsCheckpoint.timestamp = newTimestamp
  snapshotsCheckpoint.save()
  log.info('[SyncSnapshots] Snapshots synced timestamp={}', [newTimestamp.toString()])
}

function _getUserBoostedOsTokenShares(
  osToken: OsToken,
  user: Address,
  leveragePositions: Array<LeverageStrategyPosition>,
): BigInt {
  let boostPosition: LeverageStrategyPosition
  for (let i = 0; i < leveragePositions.length; i++) {
    boostPosition = leveragePositions[i]
    if (Address.fromBytes(boostPosition.user).equals(user)) {
      return boostPosition.osTokenShares
        .plus(boostPosition.exitingOsTokenShares)
        .plus(convertAssetsToOsTokenShares(osToken, boostPosition.assets.plus(boostPosition.exitingAssets)))
    }
  }
  return BigInt.zero()
}

function _getRewardSplitterAssets(user: Address, rewardSplitters: Array<RewardSplitter>): BigInt {
  let rewardSplitterAssets = BigInt.zero()
  for (let i = 0; i < rewardSplitters.length; i++) {
    const rewardSplitterAddress = Address.fromString(rewardSplitters[i].id)
    const shareHolder = loadRewardSplitterShareHolder(user, rewardSplitterAddress)
    if (shareHolder) {
      rewardSplitterAssets = rewardSplitterAssets.plus(shareHolder.earnedVaultAssets)
    }
  }
  return rewardSplitterAssets
}
