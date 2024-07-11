import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { V2Pool } from '../../generated/schema'
import { V2_POOL_FEE_PERCENT, WAD } from '../helpers/constants'

const poolId = '1'

export function createOrLoadV2Pool(): V2Pool {
  let pool = V2Pool.load(poolId)

  if (pool === null) {
    pool = new V2Pool(poolId)
    pool.totalAssets = BigInt.zero()
    pool.rewardAssets = BigInt.zero()
    pool.principalAssets = BigInt.zero()
    pool.penaltyAssets = BigInt.zero()
    pool.feePercent = I32.parseInt(V2_POOL_FEE_PERCENT)
    pool.rate = BigInt.fromString(WAD)
    pool.migrated = false
    pool.apySnapshotsCount = BigInt.zero()
    pool.apy = BigDecimal.zero()
    pool.weeklyApy = BigDecimal.zero()
    pool.executionApy = BigDecimal.zero()
    pool.consensusApy = BigDecimal.zero()
    pool.save()
  }

  return pool
}
