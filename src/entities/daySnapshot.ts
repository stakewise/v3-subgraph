import { BigInt } from '@graphprotocol/graph-ts'

import { DaySnapshot, Vault } from '../../generated/schema'


export function getRewardPerAsset(reward: BigInt, feePercent: number, principalAssets: BigInt): BigInt {
  const maxFeePercent = BigInt.fromI32(10000)
  const vaultFeePercent = BigInt.fromI32(feePercent)
  const percent = maxFeePercent.minus(vaultFeePercent)

  return reward.times(percent).div(maxFeePercent).div(principalAssets)
}

function getLastSnapshot(vaultId: string): DaySnapshot | null {
  const vault = Vault.load(vaultId)

  if (vault && vault.daySnapshots) {
    const lastSnapshotId = vault.daySnapshots[0]

    if (lastSnapshotId) {
      return DaySnapshot.load(lastSnapshotId)
    }
  }

  return null
}

const day = 24 * 60 * 60 * 1000
const dayBigInt = BigInt.fromI32(day)

export function getStartOfDay(timestamp: BigInt): string {
  return timestamp.div(dayBigInt).times(dayBigInt).toString()
}

export function createOrLoadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot {
  const dayStart = getStartOfDay(timestamp)

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
