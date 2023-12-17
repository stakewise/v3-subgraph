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
  totalReward: BigInt,
): void {
  if (fromTimestamp === null) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  const rewardPerAsset = getRewardPerAsset(totalReward, vault.principalAssets, vault.feePercent)
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

  const snapshotId = `${vault.id}-${vault.apySnapshotsCount}`
  const vaultApySnapshot = new VaultApySnapshot(snapshotId)
  vaultApySnapshot.apy = currentApy
  vaultApySnapshot.periodReward = totalReward
  vaultApySnapshot.principalAssets = vault.principalAssets
  // TODO: convert to epochs
  vaultApySnapshot.fromTimestamp = fromTimestamp
  vaultApySnapshot.toTimestamp = toTimestamp
  vaultApySnapshot.save()

  vault.currentApy = currentApy
  vault.weeklyApy = apySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  vault.apySnapshotsCount = vault.apySnapshotsCount.plus(BigInt.fromI32(1))
}

export function updatePoolApy(
  pool: V2Pool,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  totalReward: BigInt,
): void {
  if (fromTimestamp === null) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  const rewardPerAsset = getRewardPerAsset(totalReward, pool.principalAssets, pool.feePercent)
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

  const snapshotId = `${pool.id}-${pool.apySnapshotsCount}`
  const poolApySnapshot = new VaultApySnapshot(snapshotId)
  poolApySnapshot.apy = currentApy
  poolApySnapshot.periodReward = totalReward
  poolApySnapshot.principalAssets = pool.principalAssets
  // TODO: convert to epochs
  poolApySnapshot.fromTimestamp = fromTimestamp
  poolApySnapshot.toTimestamp = toTimestamp
  poolApySnapshot.save()

  pool.currentApy = currentApy
  pool.weeklyApy = apySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  pool.apySnapshotsCount = pool.apySnapshotsCount.plus(BigInt.fromI32(1))
}

export function updateOsTokenApy(osToken: OsToken): void {
  let rewardPerSecondSum = BigInt.zero()
  let snapshotsCounter = 0

  for (let i = 0; i < snapshotsPerWeek; i++) {
    const snapshot = OsTokenSnapshot.load(osToken.snapshotsCount.minus(BigInt.fromI32(i)).toString())
    if (snapshot === null) {
      break
    }

    rewardPerSecondSum = rewardPerSecondSum.plus(snapshot.avgRewardPerSecond)
    snapshotsCounter += 1
  }

  if (snapshotsCounter > 0) {
    osToken.apy = BigDecimal.fromString(rewardPerSecondSum.toString())
      .times(BigDecimal.fromString(secondsInYear))
      .times(BigDecimal.fromString(maxPercent))
      .div(BigDecimal.fromString(snapshotsCounter.toString()))
      .div(BigDecimal.fromString(wad))
  }
}
