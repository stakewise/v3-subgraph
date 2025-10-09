import { BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { V2Pool, Vault } from '../../generated/schema'
import { V2_REWARD_TOKEN } from '../helpers/constants'
import { chunkedMulticall, encodeContractCall, isFailedUpdateStateCall } from '../helpers/utils'
import { getUpdateStateCall } from './vault'

const poolId = '1'
const poolRewardAssetsSelector = '0x18160ddd'

export function loadV2Pool(): V2Pool | null {
  return V2Pool.load(poolId)
}

export function createOrLoadV2Pool(): V2Pool {
  let pool = V2Pool.load(poolId)

  if (pool === null) {
    pool = new V2Pool(poolId)
    pool.rewardAssets = BigInt.zero()
    pool.migrated = false
    pool.isDisconnected = false
    pool.save()
  }

  return pool
}

export function getV2PoolRewardAssets(vault: Vault): BigInt {
  if (isFailedUpdateStateCall(vault)) {
    const v2Pool = loadV2Pool()
    if (v2Pool === null) {
      log.error('[V2Pool] getV2PoolState failed to load V2Pool on failed updateState call', [])
      return BigInt.zero()
    }
    return v2Pool.rewardAssets
  }
  const updateStateCalls = getUpdateStateCall(vault)
  let contractCalls: Array<ethereum.Value> = [
    encodeContractCall(V2_REWARD_TOKEN, Bytes.fromHexString(poolRewardAssetsSelector)),
  ]

  const results = chunkedMulticall(updateStateCalls, contractCalls)
  return ethereum.decode('uint256', results[0]!)!.toBigInt()
}
