import { BigInt } from '@graphprotocol/graph-ts'

import { DaySnapshot } from '../../generated/schema'


export function getRewardPerAsset(reward: BigInt, feePercent: number, principalAssets: BigInt): BigInt {
  const maxFeePercent = BigInt.fromI32(10000)
  const vaultFeePercent = BigInt.fromI32(feePercent)
  const percent = maxFeePercent.minus(vaultFeePercent)

  return reward.times(percent).div(maxFeePercent).div(principalAssets)
}

export function createOrLoadDaySnapshot(date: BigInt, vaultAddress: string): DaySnapshot {
  const daySnapshotId = `${vaultAddress}-${date}`

  let vaultDaySnapshot = DaySnapshot.load(daySnapshotId)

  if (vaultDaySnapshot === null) {
    vaultDaySnapshot = new DaySnapshot(daySnapshotId)
    vaultDaySnapshot.date = date.toI32()
    vaultDaySnapshot.totalAssets = BigInt.fromI32(0)
    vaultDaySnapshot.principalAssets = BigInt.fromI32(0)
    vaultDaySnapshot.rewardPerAsset = BigInt.fromI32(0)
    vaultDaySnapshot.vault = vaultAddress

    vaultDaySnapshot.save()
  }

  return vaultDaySnapshot
}
