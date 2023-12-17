import { BigInt } from '@graphprotocol/graph-ts'

import { V2Pool } from '../../generated/schema'

const poolId = '1'

export function createOrLoadV2Pool(): V2Pool {
  let pool = V2Pool.load(poolId)

  if (pool === null) {
    pool = new V2Pool(poolId)
    pool.totalAssets = BigInt.zero()
    pool.rewardAssets = BigInt.zero()
    pool.principalAssets = BigInt.zero()
    pool.feePercent = 1000
    pool.apySnapshotsCount = BigInt.zero()
    pool.save()
  }

  return pool
}
