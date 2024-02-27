import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken, OsTokenSnapshot, V2Pool, Vault, VaultApySnapshot } from '../../generated/schema'
import { WAD } from '../helpers/constants'

const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'

export function getRewardPerAsset(
  reward: BigInt,
  totalAssets: BigInt,
  feePercent: i32,
  totalDuration: BigInt,
): BigDecimal {
  if (totalAssets.le(BigInt.zero()) || totalDuration.le(BigInt.zero())) {
    return BigDecimal.zero()
  }

  // Constants
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

function _calculateMedian(values: Array<BigDecimal>): BigDecimal {
  if (values.length === 0) {
    return BigDecimal.fromString('0')
  }

  // Sort the values
  const sortedValues = values.sort((a, b) => (a.lt(b) ? -1 : a.gt(b) ? 1 : 0))
  const mid = sortedValues.length / 2

  if (sortedValues.length % 2 !== 0) {
    // For odd number of elements, directly access the middle element
    return sortedValues[(mid - 0.5) as i32] // Adjusting for 0-based index
  } else {
    // For even number of elements, calculate the average of the two middle elements
    const lowerMidIndex = mid - 1
    const upperMidIndex = mid
    return sortedValues[lowerMidIndex as i32].plus(sortedValues[upperMidIndex as i32]).div(BigDecimal.fromString('2'))
  }
}

function _calculateAverage(values: Array<BigDecimal>): BigDecimal {
  if (values.length === 0) {
    return BigDecimal.fromString('0')
  }

  // Start with a sum of zero.
  let sum: BigDecimal = BigDecimal.fromString('0')

  // Iterate over all values to calculate the sum.
  for (let i = 0; i < values.length; i++) {
    sum = sum.plus(values[i])
  }

  // Divide the sum by the number of values to get the average.
  // Note: BigDecimal division needs to handle scale/precision appropriately.
  // Here, 'values.length' is converted to a BigDecimal for division.
  return sum.div(BigDecimal.fromString(values.length.toString()))
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
  let executionApys: Array<BigDecimal> = [currentExecApy]
  let consensusApys: Array<BigDecimal> = [currentConsensusApy]
  const totalSnapshots = vault.apySnapshotsCount
  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshotId = `${vault.id}-${totalSnapshots.minus(BigInt.fromI32(i))}`
    const snapshot = VaultApySnapshot.load(snapshotId)
    if (snapshot === null) {
      break
    }
    executionApys.push(snapshot.executionApy)
    consensusApys.push(snapshot.consensusApy)
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

  vault.executionApy = _calculateAverage(executionApys)
  vault.consensusApy = _calculateAverage(consensusApys)
  vault.apy = vault.executionApy.plus(vault.consensusApy)
  vault.weeklyApy = vault.apy
  vault.medianExecutionApy = _calculateMedian(executionApys)
  vault.medianConsensusApy = _calculateMedian(consensusApys)
  vault.medianApy = vault.medianExecutionApy.plus(vault.medianConsensusApy)
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
  let execApys: Array<BigDecimal> = [currentExecApy]
  let consensusApys: Array<BigDecimal> = [currentConsensusApy]
  const totalSnapshots = pool.apySnapshotsCount
  for (let i = 1; i < snapshotsPerWeek; i++) {
    const snapshotId = `${pool.id}-${totalSnapshots.minus(BigInt.fromI32(i))}`
    const snapshot = VaultApySnapshot.load(snapshotId)
    if (snapshot === null) {
      break
    }
    execApys.push(snapshot.executionApy)
    consensusApys.push(snapshot.consensusApy)
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

  pool.executionApy = _calculateAverage(execApys)
  pool.consensusApy = _calculateAverage(consensusApys)
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
    .div(BigDecimal.fromString(WAD))
}
