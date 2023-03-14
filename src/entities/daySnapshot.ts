import { BigInt, BigDecimal } from '@graphprotocol/graph-ts'

import { DaySnapshot, Vault } from '../../generated/schema'
import { DAY } from '../helpers/constants'


const snapshotsCount = 7

export function getRewardPerAsset(reward: BigInt, principalAssets: BigInt): BigDecimal {
  const rewardDecimal = BigDecimal.fromString(reward.toString())
  const principalAssetsDecimal = BigDecimal.fromString(principalAssets.toString())
  return rewardDecimal.div(principalAssetsDecimal)
}

export function loadDaySnapshot(timestamp: BigInt, vaultId: string): DaySnapshot | null {
  const dayStart = timestamp.div(DAY).times(DAY).toString()

  const daySnapshotId = `${vaultId}-${dayStart}`

  return DaySnapshot.load(daySnapshotId)
}

function getPreviousSnapshot(date: i32, vault: Vault): DaySnapshot | null {
  const prevDate = BigInt.fromI32(date).minus(DAY)
  const dayCreated = vault.createdAt.div(DAY).times(DAY)
  const isValidDate = prevDate.minus(dayCreated).ge(BigInt.zero())

  if (isValidDate) {
    const prevSnapshotId = `${vault.id}-${prevDate}`
    const prevSnapshot = DaySnapshot.load(prevSnapshotId)

    if (prevSnapshot) {
      return prevSnapshot
    }

    return getPreviousSnapshot(prevDate.toI32(), vault)
  }

  return null
}

export function saveDaySnapshot(daySnapshot: DaySnapshot): void {
  const vault = Vault.load(daySnapshot.vault) as Vault

  daySnapshot.prevTotalAssets = BigInt.zero()
  daySnapshot.prevPrincipalAssets = BigInt.zero()
  daySnapshot.prevRewardPerAsset = BigDecimal.zero()

  if (vault) {
    const prevSnapshot = getPreviousSnapshot(daySnapshot.date, vault)

    if (prevSnapshot) {
      daySnapshot.prevTotalAssets = prevSnapshot.totalAssets
      daySnapshot.prevPrincipalAssets = prevSnapshot.principalAssets
      daySnapshot.prevRewardPerAsset = prevSnapshot.prevRewardPerAsset
    }
  }

  daySnapshot.save()
}

export function createOrLoadDaySnapshot(timestamp: BigInt, vault: Vault): DaySnapshot {
  const dayStart = timestamp.div(DAY).times(DAY).toI32()

  const daySnapshotId = `${vault.id}-${dayStart}`
  let daySnapshot = DaySnapshot.load(daySnapshotId)

  if (daySnapshot === null) {
    daySnapshot = new DaySnapshot(daySnapshotId)

    daySnapshot.date = dayStart
    daySnapshot.totalAssets = vault.totalAssets
    daySnapshot.principalAssets = vault.totalAssets.minus(vault.consensusReward).minus(vault.executionReward)
    daySnapshot.rewardPerAsset = BigDecimal.zero()
    daySnapshot.vault = vault.id

    saveDaySnapshot(daySnapshot)
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
