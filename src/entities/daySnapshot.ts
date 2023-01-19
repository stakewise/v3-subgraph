import { BigInt } from '@graphprotocol/graph-ts'

import { DaySnapshot } from '../../generated/schema'


export function getRewardPerAsset(reward: BigInt, feePercent: i32, principalAssets: BigInt): BigInt {
  const maxFeePercent = BigInt.fromI32(10000)
  const vaultFeePercent = BigInt.fromI32(feePercent)
  const percent = maxFeePercent.minus(vaultFeePercent)

  return reward.times(percent).div(maxFeePercent).div(principalAssets)
}

const day = 24 * 60 * 60 * 1000
const dayBigInt = BigInt.fromI32(day)

export function loadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot | null {
  const dayStart = timestamp.div(dayBigInt).times(dayBigInt).toString()

  const daySnapshotId = `${vaultId}-${dayStart}`

  return DaySnapshot.load(daySnapshotId)
}

export function createOrLoadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot {
  const dayStart = timestamp.div(dayBigInt).times(dayBigInt).toString()

  const daySnapshotId = `${vaultId}-${dayStart}`
  let daySnapshot = DaySnapshot.load(daySnapshotId)

  if (daySnapshot === null) {
    daySnapshot = new DaySnapshot(daySnapshotId)

    daySnapshot.date = timestamp.toI32()
    daySnapshot.totalAssets = BigInt.fromI32(0)
    daySnapshot.principalAssets = BigInt.fromI32(0)
    daySnapshot.rewardPerAsset = BigInt.fromI32(0)
    daySnapshot.vault = vaultId

    daySnapshot.save()
  }

  return daySnapshot
}
