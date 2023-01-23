import { BigInt } from '@graphprotocol/graph-ts'

import { DaySnapshot } from '../../generated/schema'
import { DAY, MAX_FEE_PERCENT } from '../helpers/constants'


export function getRewardPerAsset(reward: BigInt, feePercent: i32, principalAssets: BigInt): BigInt {
  const vaultFeePercent = BigInt.fromI32(feePercent)
  const percent = MAX_FEE_PERCENT.minus(vaultFeePercent)

  return reward.times(percent).div(MAX_FEE_PERCENT).div(principalAssets)
}

export function loadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot | null {
  const dayStart = timestamp.div(DAY).times(DAY).toString()

  const daySnapshotId = `${vaultId}-${dayStart}`

  return DaySnapshot.load(daySnapshotId)
}

export function createOrLoadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot {
  const dayStart = timestamp.div(DAY).times(DAY).toI32()

  const daySnapshotId = `${vaultId}-${dayStart}`
  let daySnapshot = DaySnapshot.load(daySnapshotId)

  if (daySnapshot === null) {
    daySnapshot = new DaySnapshot(daySnapshotId)

    daySnapshot.date = dayStart
    daySnapshot.totalAssets = BigInt.fromI32(0)
    daySnapshot.principalAssets = BigInt.fromI32(0)
    daySnapshot.rewardPerAsset = BigInt.fromI32(0)
    daySnapshot.vault = vaultId

    daySnapshot.save()
  }

  return daySnapshot
}
