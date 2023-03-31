import { BigInt, BigDecimal } from '@graphprotocol/graph-ts'

import { DaySnapshot, Vault } from '../../generated/schema'
import { DAY } from '../helpers/constants'


const snapshotsCount = 7

export function getRewardPerAsset(reward: BigInt, principalAssets: BigInt, feePercent: i32): BigDecimal {
  if (principalAssets.le(BigInt.zero())) {
    return BigDecimal.zero()
  }
  const rewardDecimal = BigDecimal.fromString(reward.toString())
  const principalAssetsDecimal = BigDecimal.fromString(principalAssets.toString())
  const rewardPerAsset = rewardDecimal.div(principalAssetsDecimal)

  const maxPercentDecimal = BigDecimal.fromString('10000')
  const feePercentDecimal = BigDecimal.fromString(feePercent.toString())
  const feePerAsset = rewardPerAsset.times(feePercentDecimal).div(maxPercentDecimal)

  return rewardPerAsset.minus(feePerAsset)
}

export function loadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot | null {
  const dayStart = timestamp.div(DAY).times(DAY).toString()

  const daySnapshotId = `${vaultId}-${dayStart}`

  return DaySnapshot.load(daySnapshotId)
}

export function createOrLoadDaySnapshot(timestamp: BigInt, vault: Vault): DaySnapshot {
  const dayStart = timestamp.div(DAY).times(DAY).toI32()

  const daySnapshotId = `${vault.id}-${dayStart}`
  let daySnapshot = DaySnapshot.load(daySnapshotId)

  if (daySnapshot === null) {
    daySnapshot = new DaySnapshot(daySnapshotId)

    daySnapshot.date = dayStart
    daySnapshot.totalAssets = vault.totalAssets
    daySnapshot.rewardPerAsset = BigDecimal.zero()
    daySnapshot.vault = vault.id

    daySnapshot.save()
  }

  return daySnapshot
}

export function updateAvgRewardPerAsset(timestamp: BigInt, vault: Vault): void {
  let avgRewardPerAsset = BigDecimal.zero()
  let snapshotsCountDecimal = BigDecimal.fromString(snapshotsCount.toString())

  for (let i = 1; i <= snapshotsCount; i++) {
    const diff = DAY.times(BigInt.fromI32(i))
    const daySnapshot = loadDaySnapshot(timestamp.minus(diff), vault.id)

    if (daySnapshot) {
      avgRewardPerAsset = avgRewardPerAsset.plus(daySnapshot.rewardPerAsset)
    }
    else {
      snapshotsCountDecimal = snapshotsCountDecimal.minus(BigDecimal.fromString('1'))
    }
  }

  if (snapshotsCountDecimal.gt(BigDecimal.zero())) {
    vault.avgRewardPerAsset = avgRewardPerAsset.div(snapshotsCountDecimal)
  }
}
