import { BigInt } from '@graphprotocol/graph-ts'

import { DaySnapshot } from '../../generated/schema'


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
