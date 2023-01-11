import { Address } from '@graphprotocol/graph-ts'

import { DaySnapshot } from '../../generated/schema'


export function createOrLoadDaySnapshot(date: number, vaultAddress: Address): DaySnapshot {
  const daySnapshotId = `${vaultAddress.toHex()}-${date}`

  let vaultDaySnapshot = DaySnapshot.load(daySnapshotId)

  if (vaultDaySnapshot === null) {
    vaultDaySnapshot = new DaySnapshot(daySnapshotId)
    vaultDaySnapshot.save()
  }

  return vaultDaySnapshot
}
