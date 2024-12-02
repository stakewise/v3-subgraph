import { BigInt } from '@graphprotocol/graph-ts'
import { SnapshotEarnedAssets } from '../../generated/schema'

const secondsInDay = 86400

export function createOrLoadSnapshotEarnedAssets(
  prefix: string,
  entityId: string,
  timestamp: BigInt,
): SnapshotEarnedAssets {
  const daysCount = timestamp.div(BigInt.fromI32(secondsInDay))
  const snapshotId = prefix + '-' + entityId + '-' + daysCount.toString()
  let snapshotEarnedAssets = SnapshotEarnedAssets.load(snapshotId)
  if (snapshotEarnedAssets === null) {
    snapshotEarnedAssets = new SnapshotEarnedAssets(snapshotId)
    snapshotEarnedAssets.timestamp = timestamp.toI64()
    snapshotEarnedAssets.earnedAssets = BigInt.zero()
    snapshotEarnedAssets.save()
  }
  return snapshotEarnedAssets
}
