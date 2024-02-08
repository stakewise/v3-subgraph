import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken, OsTokenSnapshot, V2Pool, Vault, VaultApySnapshot } from '../../generated/schema'

const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'
const wad = '1000000000000000000'

export function getRewardPerAsset(
  reward: BigInt,
  totalAssets: BigInt,
  feePercent: i32,
  totalDuration: BigInt,
): BigDecimal {
  if (totalAssets.le(BigInt.zero())) {
    return BigDecimal.zero()
  }
  const maxPercentDecimal = BigDecimal.fromString('10000')
  const feePercentDecimal = BigDecimal.fromString(feePercent.toString())
  const rewardDecimal = BigDecimal.fromString(reward.toString())
    .times(maxPercentDecimal.minus(feePercentDecimal))
    .div(maxPercentDecimal)

  const totalAssetsDecimal = BigDecimal.fromString(totalAssets.toString())
  return rewardDecimal
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(totalAssetsDecimal)
    .div(BigDecimal.fromString(totalDuration.toString()))
}

// function _calculateMedian(values: Array<BigDecimal>): BigDecimal {
//   const sortedValues = values.sort((a, b) => (a.lt(b) ? -1 : 1))
//   const mid = sortedValues.length / 2
//   return sortedValues.length % 2 !== 0
//     ? sortedValues[i32(mid)]
//     : sortedValues[mid - 1].plus(sortedValues[mid]).div(BigDecimal.fromString('2'))
// }

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
  const currentExecApy = getRewardPerAsset(
    periodExecutionReward,
    vault.principalAssets,
    vault.feePercent,
    totalDuration,
  )
  const currentConsensusApy = getRewardPerAsset(
    periodConsensusReward,
    vault.principalAssets,
    vault.feePercent,
    totalDuration,
  )

  // calculate weekly apy
  let execApySum = currentExecApy
  let consensusApySum = currentConsensusApy
  let snapshotsCounter = 1
  const totalSnapshots = vault.apySnapshotsCount
  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshotId = `${vault.id}-${totalSnapshots.minus(BigInt.fromI32(i))}`
    const snapshot = VaultApySnapshot.load(snapshotId)
    if (snapshot === null) {
      break
    }
    execApySum = execApySum.plus(snapshot.executionApy)
    consensusApySum = consensusApySum.plus(snapshot.consensusApy)
    snapshotsCounter += 1
  }

  const snapshotId = `${vault.id}-${totalSnapshots}`
  const vaultApySnapshot = new VaultApySnapshot(snapshotId)
  vaultApySnapshot.apy = currentExecApy.plus(currentConsensusApy)
  vaultApySnapshot.executionApy = currentExecApy
  vaultApySnapshot.consensusApy = currentConsensusApy
  vaultApySnapshot.periodExecutionReward = periodExecutionReward
  vaultApySnapshot.periodConsensusReward = periodConsensusReward
  vaultApySnapshot.principalAssets = vault.principalAssets
  vaultApySnapshot.fromEpochTimestamp = fromTimestamp
  vaultApySnapshot.toEpochTimestamp = toTimestamp
  vaultApySnapshot.vault = vault.id
  vaultApySnapshot.save()

  vault.executionApy = execApySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  vault.consensusApy = consensusApySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  vault.apy = vault.executionApy.plus(vault.consensusApy)
  vault.weeklyApy = vault.apy
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
  const currentExecApy = getRewardPerAsset(periodExecutionReward, pool.principalAssets, pool.feePercent, totalDuration)
  const currentConsensusApy = getRewardPerAsset(
    periodConsensusReward,
    pool.principalAssets,
    pool.feePercent,
    totalDuration,
  )

  // calculate weekly apy
  let execApySum = currentExecApy
  let consensusApySum = currentConsensusApy
  let snapshotsCounter = 1
  const totalSnapshots = pool.apySnapshotsCount
  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshotId = `${pool.id}-${totalSnapshots.minus(BigInt.fromI32(i))}`
    const snapshot = VaultApySnapshot.load(snapshotId)
    if (snapshot === null) {
      break
    }
    execApySum = execApySum.plus(snapshot.executionApy)
    consensusApySum = consensusApySum.plus(snapshot.consensusApy)
    snapshotsCounter += 1
  }

  const snapshotId = `${pool.id}-${totalSnapshots}`
  const poolApySnapshot = new VaultApySnapshot(snapshotId)
  poolApySnapshot.apy = currentExecApy.plus(currentConsensusApy)
  poolApySnapshot.executionApy = currentExecApy
  poolApySnapshot.consensusApy = currentConsensusApy
  poolApySnapshot.periodExecutionReward = periodExecutionReward
  poolApySnapshot.periodConsensusReward = periodConsensusReward
  poolApySnapshot.principalAssets = pool.principalAssets
  poolApySnapshot.fromEpochTimestamp = fromTimestamp
  poolApySnapshot.toEpochTimestamp = toTimestamp
  poolApySnapshot.save()

  pool.executionApy = execApySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  pool.consensusApy = consensusApySum.div(BigDecimal.fromString(snapshotsCounter.toString()))
  pool.apy = pool.executionApy.plus(pool.consensusApy)
  pool.weeklyApy = pool.apy
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
