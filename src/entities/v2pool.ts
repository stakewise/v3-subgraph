import { BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { V2Pool, V2PoolUser, Vault } from '../../generated/schema'
import { V2_POOL_FEE_PERCENT, V2_REWARD_TOKEN, V2_STAKED_TOKEN, WAD } from '../helpers/constants'
import { chunkedMulticall, encodeContractCall, isFailedUpdateStateCall } from '../helpers/utils'
import { getUpdateStateCall } from './vault'

const poolId = '1'
const poolRewardAssetsSelector = '0x18160ddd'
const poolPrincipalAssetsSelector = '0x18160ddd'
const poolPenaltyAssetsSelector = '0xe6af61c8'
const rewardPerTokenSelector = '0xcd3daf9d'

export function loadV2Pool(): V2Pool | null {
  return V2Pool.load(poolId)
}

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
    pool.isDisconnected = false
    pool.apy = BigDecimal.zero()
    pool.save()
  }

  return pool
}

export function createOrLoadV2PoolUser(userAddress: Bytes): V2PoolUser {
  const id = userAddress.toHexString()
  let v2PoolUser = V2PoolUser.load(id)

  if (v2PoolUser === null) {
    v2PoolUser = new V2PoolUser(id)
    v2PoolUser.balance = BigInt.zero()
    v2PoolUser.save()
  }

  return v2PoolUser
}

export function getV2PoolState(vault: Vault): Array<BigInt> {
  if (isFailedUpdateStateCall(vault)) {
    const v2Pool = loadV2Pool()
    if (v2Pool === null) {
      log.error('[V2Pool] getV2PoolState failed to load V2Pool on failed updateState call', [])
      return [BigInt.fromString(WAD), BigInt.zero(), BigInt.zero(), BigInt.zero()]
    }
    return [v2Pool.rate, v2Pool.rewardAssets, v2Pool.principalAssets, v2Pool.penaltyAssets]
  }
  const updateStateCalls = getUpdateStateCall(vault)
  const wad = BigInt.fromString(WAD)

  let contractCalls: Array<ethereum.Value> = [
    encodeContractCall(V2_REWARD_TOKEN, Bytes.fromHexString(poolRewardAssetsSelector)),
    encodeContractCall(V2_REWARD_TOKEN, Bytes.fromHexString(poolPenaltyAssetsSelector)),
    encodeContractCall(V2_STAKED_TOKEN, Bytes.fromHexString(poolPrincipalAssetsSelector)),
    encodeContractCall(V2_REWARD_TOKEN, Bytes.fromHexString(rewardPerTokenSelector)),
  ]

  const results = chunkedMulticall(updateStateCalls, contractCalls)
  const rewardAssets = ethereum.decode('uint256', results[0]!)!.toBigInt()
  const penaltyAssets = ethereum.decode('uint256', results[1]!)!.toBigInt()
  const principalAssets = ethereum.decode('uint256', results[2]!)!.toBigInt()
  const rewardRate = ethereum.decode('uint256', results[3]!)!.toBigInt()
  const totalAssets = principalAssets.plus(rewardAssets)
  let penaltyRate = BigInt.zero()
  if (totalAssets.gt(BigInt.zero())) {
    penaltyRate = wad.times(penaltyAssets).div(totalAssets)
  }
  const newRate = wad.plus(rewardRate).minus(penaltyRate)
  return [newRate, rewardAssets, principalAssets, penaltyAssets]
}
