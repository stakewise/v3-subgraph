import { Address, BigInt, ethereum, log, TypedMap } from '@graphprotocol/graph-ts'
import { Allocator, RewardSplitter, RewardSplitterShareHolder, Vault } from '../../generated/schema'
import { loadOsToken } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import { createVaultSnapshot, loadVault } from '../entities/vault'
import { loadDistributor } from '../entities/merkleDistributor'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { createAllocatorSnapshot } from '../entities/allocator'
import { MAIN_META_VAULT } from '../helpers/constants'
import { createStakerSnapshot, loadStaker } from '../entities/staker'

const secondsInDay = 86400
const extraSecondsGap = 30

export function syncSnapshots(block: ethereum.Block): void {
  const newTimestamp = block.timestamp
  if (!_isDayEnd(newTimestamp)) {
    return
  }

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

  const duration = newTimestamp.minus(snapshotsCheckpoint.timestamp)

  let vault: Vault
  const vaultIds = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    vault = loadVault(Address.fromString(vaultIds[i]))!
    if (!vault.isCollateralized) {
      continue
    }

    createVaultSnapshot(vault, duration, newTimestamp.toI64())

    const allocators: Array<Allocator> = vault.allocators.load()
    const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()

    // Build map once per vault
    const rewardSplitterAssetsMap = _buildRewardSplitterAssetsMap(rewardSplitters)

    for (let j = 0; j < allocators.length; j++) {
      const allocator = allocators[j]
      const allocatorAddressHex = allocator.address.toHex()

      const rewardSplitterAssets = rewardSplitterAssetsMap.isSet(allocatorAddressHex)
        ? rewardSplitterAssetsMap.get(allocatorAddressHex)!
        : BigInt.zero()

      createAllocatorSnapshot(osToken, allocator, rewardSplitterAssets, duration, newTimestamp.toI64())
    }
  }

  // Create staker snapshots for mainMetaVault allocators
  const mainMetaVault = loadVault(Address.fromString(MAIN_META_VAULT))
  if (mainMetaVault !== null) {
    const mainMetaVaultAllocators: Array<Allocator> = mainMetaVault.allocators.load()
    for (let i = 0; i < mainMetaVaultAllocators.length; i++) {
      const staker = loadStaker(Address.fromBytes(mainMetaVaultAllocators[i].address))
      if (staker !== null) {
        createStakerSnapshot(staker, duration, newTimestamp.toI64())
      }
    }
  }

  snapshotsCheckpoint.timestamp = newTimestamp
  snapshotsCheckpoint.save()
  log.info('[SyncSnapshots] Snapshots synced block={} timestamp={}', [block.number.toString(), newTimestamp.toString()])
}

function _buildRewardSplitterAssetsMap(rewardSplitters: Array<RewardSplitter>): TypedMap<string, BigInt> {
  const assetsMap = new TypedMap<string, BigInt>()

  for (let i = 0; i < rewardSplitters.length; i++) {
    const shareHolders: Array<RewardSplitterShareHolder> = rewardSplitters[i].shareHolders.load()

    for (let j = 0; j < shareHolders.length; j++) {
      const shareHolder = shareHolders[j]
      const holderAddressHex = shareHolder.address.toHex()

      if (assetsMap.isSet(holderAddressHex)) {
        const existingAssets = assetsMap.get(holderAddressHex)!
        assetsMap.set(holderAddressHex, existingAssets.plus(shareHolder.earnedVaultAssets))
      } else {
        assetsMap.set(holderAddressHex, shareHolder.earnedVaultAssets)
      }
    }
  }

  return assetsMap
}

function _isDayEnd(timestamp: BigInt): boolean {
  const currentDayCount = timestamp.div(BigInt.fromI32(secondsInDay))
  const newDayCount = timestamp.plus(BigInt.fromI32(extraSecondsGap)).div(BigInt.fromI32(secondsInDay))
  return newDayCount.gt(currentDayCount)
}
