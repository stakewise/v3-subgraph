import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken, OsTokenSnapshot, V2Pool, Vault, VaultApySnapshot } from '../../generated/schema'

const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'
const wad = '1000000000000000000'

export function getRewardPerAsset(reward: BigInt, totalAssets: BigInt, feePercent: i32): BigDecimal {
  if (totalAssets.le(BigInt.zero())) {
    return BigDecimal.zero()
  }
  const maxPercentDecimal = BigDecimal.fromString('10000')
  const feePercentDecimal = BigDecimal.fromString(feePercent.toString())
  const rewardDecimal = BigDecimal.fromString(reward.toString())
    .times(maxPercentDecimal.minus(feePercentDecimal))
    .div(maxPercentDecimal)

  const totalAssetsDecimal = BigDecimal.fromString(totalAssets.toString())
  return rewardDecimal.div(totalAssetsDecimal)
}

export function updateVaultApy(
  vault: Vault,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  periodConsensusReward: BigInt,
  periodExecutionReward: BigInt,
): void {
  if (fromTimestamp === null) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  const rewardPerAsset = getRewardPerAsset(
    periodConsensusReward.plus(periodExecutionReward),
    vault.principalAssets,
    vault.feePercent,
  )
  const currentApy = rewardPerAsset
    .times(BigDecimal.fromString(secondsInYear))
    .div(BigDecimal.fromString(totalDuration.toString()))
    .times(BigDecimal.fromString(maxPercent))

  // calculate weekly apy
  let apySum = currentApy
  let snapshotsCounter = 1
  const totalSnapshots = vault.apySnapshotsCount
  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshotId = `${vault.id}-${totalSnapshots.minus(BigInt.fromI32(i))}`
    const snapshot = VaultApySnapshot.load(snapshotId)
    if (snapshot === null) {
      break
    }

    apySum = apySum.plus(snapshot.apy)
    snapshotsCounter += 1
  }

  const snapshotId = `${vault.id}-${totalSnapshots}`
  const vaultApySnapshot = new VaultApySnapshot(snapshotId)
  vaultApySnapshot.apy = currentApy
  vaultApySnapshot.periodExecutionReward = periodExecutionReward
  vaultApySnapshot.periodConsensusReward = periodConsensusReward
  vaultApySnapshot.principalAssets = vault.principalAssets
  // TODO: convert to epochs
  vaultApySnapshot.fromEpochTimestamp = fromTimestamp
  vaultApySnapshot.toEpochTimestamp = toTimestamp
  vaultApySnapshot.vault = vault.id
  vaultApySnapshot.save()

  vault.currentApy = currentApy
  vault.weeklyApy = apySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  vault.apySnapshotsCount = vault.apySnapshotsCount.plus(BigInt.fromI32(1))
}

export function updatePoolApy(
  pool: V2Pool,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  periodConsensusReward: BigInt,
  periodExecutionReward: BigInt,
): void {
  if (fromTimestamp === null) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  const rewardPerAsset = getRewardPerAsset(
    periodConsensusReward.plus(periodExecutionReward),
    pool.principalAssets,
    pool.feePercent,
  )
  const currentApy = rewardPerAsset
    .times(BigDecimal.fromString(secondsInYear))
    .div(BigDecimal.fromString(totalDuration.toString()))
    .times(BigDecimal.fromString(maxPercent))

  // calculate weekly apy
  let apySum = currentApy
  let snapshotsCounter = 1
  const totalSnapshots = pool.apySnapshotsCount
  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshotId = `${pool.id}-${totalSnapshots.minus(BigInt.fromI32(i))}`
    const snapshot = VaultApySnapshot.load(snapshotId)
    if (snapshot === null) {
      break
    }

    apySum = apySum.plus(snapshot.apy)
    snapshotsCounter += 1
  }

  const snapshotId = `${pool.id}-${totalSnapshots}`
  const poolApySnapshot = new VaultApySnapshot(snapshotId)
  poolApySnapshot.apy = currentApy
  poolApySnapshot.periodExecutionReward = periodExecutionReward
  poolApySnapshot.periodConsensusReward = periodConsensusReward
  poolApySnapshot.principalAssets = pool.principalAssets
  // TODO: convert to epochs
  poolApySnapshot.fromEpochTimestamp = fromTimestamp
  poolApySnapshot.toEpochTimestamp = toTimestamp
  poolApySnapshot.save()

  pool.currentApy = currentApy
  pool.weeklyApy = apySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  pool.apySnapshotsCount = pool.apySnapshotsCount.plus(BigInt.fromI32(1))
}

export function updateOsTokenApy(osToken: OsToken, newAvgRewardPerSecond: BigInt, timestamp: BigInt): void {
  // create new snapshot
  const totalSnapshots = osToken.snapshotsCount
  const snapshot = new OsTokenSnapshot(totalSnapshots.toString())
  snapshot.avgRewardPerSecond = newAvgRewardPerSecond
  snapshot.createdAt = timestamp
  snapshot.save()

  let rewardPerSecondSum = newAvgRewardPerSecond
  let snapshotsCounter = 1

  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshot = OsTokenSnapshot.load(osToken.snapshotsCount.minus(BigInt.fromI32(i)).toString())
    if (snapshot === null) {
      break
    }

    rewardPerSecondSum = rewardPerSecondSum.plus(snapshot.avgRewardPerSecond)
    snapshotsCounter += 1
  }

  osToken.snapshotsCount = osToken.snapshotsCount.plus(BigInt.fromI32(1))
  osToken.apy = BigDecimal.fromString(rewardPerSecondSum.toString())
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(BigDecimal.fromString(snapshotsCounter.toString()))
    .div(BigDecimal.fromString(wad))
}
