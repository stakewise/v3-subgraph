import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'

import { V2Pool, DaySnapshot } from '../../generated/schema'
import { DAY } from '../helpers/constants'
import { getRewardPerAsset, loadDaySnapshot } from './daySnapshot'

const poolId = '1'
const snapshotsCount = 7

export function createOrLoadV2Pool(): V2Pool {
  let pool = V2Pool.load(poolId)

  if (pool === null) {
    pool = new V2Pool(poolId)
    pool.totalAssets = BigInt.zero()
    pool.totalRewards = BigInt.zero()
    pool.principalAssets = BigInt.zero()
    pool.feePercent = 1000
    pool.avgRewardPerAsset = BigDecimal.zero()
    pool.save()
  }

  return pool
}

export function createOrLoadV2PoolDaySnapshot(timestamp: BigInt, v2Pool: V2Pool): DaySnapshot {
  const dayStart = timestamp.div(DAY).times(DAY).toI32()

  const daySnapshotId = `${v2Pool.id}-${dayStart}`
  let daySnapshot = DaySnapshot.load(daySnapshotId)

  if (daySnapshot === null) {
    daySnapshot = new DaySnapshot(daySnapshotId)

    daySnapshot.date = dayStart
    daySnapshot.totalAssets = v2Pool.totalAssets
    daySnapshot.rewardPerAsset = BigDecimal.zero()
    daySnapshot.vault = v2Pool.id

    daySnapshot.save()
  }

  return daySnapshot
}

export function updateV2PoolDaySnapshots(
  v2Pool: V2Pool,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  totalReward: BigInt,
): void {
  if (fromTimestamp === null) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  let rewardLeft = totalReward
  let snapshotStart = fromTimestamp
  let snapshotEnd = snapshotStart.plus(DAY).div(DAY).times(DAY)

  while (snapshotEnd < toTimestamp) {
    const reward = totalReward.times(snapshotEnd.minus(snapshotStart)).div(totalDuration)
    const snapshot = createOrLoadV2PoolDaySnapshot(snapshotStart, v2Pool)
    const rewardPerAsset = getRewardPerAsset(reward, v2Pool.principalAssets, v2Pool.feePercent)
    snapshot.totalAssets = snapshot.totalAssets.plus(reward)
    snapshot.rewardPerAsset = snapshot.rewardPerAsset.plus(rewardPerAsset)
    snapshot.save()

    rewardLeft = rewardLeft.minus(reward)
    snapshotStart = snapshotEnd
    snapshotEnd = snapshotStart.plus(DAY).div(DAY).times(DAY)
  }

  if (rewardLeft.notEqual(BigInt.zero())) {
    const snapshot = createOrLoadV2PoolDaySnapshot(toTimestamp, v2Pool)
    const rewardPerAsset = getRewardPerAsset(rewardLeft, v2Pool.principalAssets, v2Pool.feePercent)
    snapshot.totalAssets = snapshot.totalAssets.plus(rewardLeft)
    snapshot.rewardPerAsset = snapshot.rewardPerAsset.plus(rewardPerAsset)
    snapshot.save()
  }
}

export function updateV2PoolAvgRewardPerAsset(timestamp: BigInt, v2Pool: V2Pool): void {
  let avgRewardPerAsset = BigDecimal.zero()
  let snapshotsCountDecimal = BigDecimal.fromString(snapshotsCount.toString())

  for (let i = 1; i <= snapshotsCount; i++) {
    const diff = DAY.times(BigInt.fromI32(i))
    const daySnapshot = loadDaySnapshot(timestamp.minus(diff), v2Pool.id)

    if (daySnapshot) {
      avgRewardPerAsset = avgRewardPerAsset.plus(daySnapshot.rewardPerAsset)
    } else {
      snapshotsCountDecimal = snapshotsCountDecimal.minus(BigDecimal.fromString('1'))
    }
  }

  if (snapshotsCountDecimal.gt(BigDecimal.zero())) {
    v2Pool.avgRewardPerAsset = avgRewardPerAsset.div(snapshotsCountDecimal)
  }
}
