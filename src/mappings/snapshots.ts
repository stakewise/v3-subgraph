import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { Allocator, RewardSplitter, Vault } from '../../generated/schema'
import { loadOsToken } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import { createVaultSnapshot, loadVault } from '../entities/vault'
import { loadRewardSplitterShareHolder } from '../entities/rewardSplitter'
import { loadDistributor } from '../entities/merkleDistributor'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { createAllocatorSnapshot } from '../entities/allocator'

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

  const duration = newTimestamp.minus(snapshotsCheckpoint.timestamp)

  let vault: Vault
  const vaultIds = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    // snapshot vault
    vault = loadVault(Address.fromString(vaultIds[i]))!
    if (!vault.isCollateralized) {
      continue
    }

    createVaultSnapshot(vault, newTimestamp.toI64())

    const allocators: Array<Allocator> = vault.allocators.load()
    const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()
    for (let j = 0; j < allocators.length; j++) {
      const allocator = allocators[j]
      const allocatorAddress = Address.fromBytes(allocator.address)

      // get assets from the reward splitters
      let rewardSplitterAssets = _getRewardSplitterAssets(allocatorAddress, rewardSplitters)

      createAllocatorSnapshot(osToken, allocator, rewardSplitterAssets, duration, newTimestamp.toI64())
    }
  }

  snapshotsCheckpoint.timestamp = newTimestamp
  snapshotsCheckpoint.save()
  log.info('[SyncSnapshots] Snapshots synced timestamp={}', [newTimestamp.toString()])
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
