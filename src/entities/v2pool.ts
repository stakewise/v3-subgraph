import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { V2Pool, V2PoolUser } from '../../generated/schema'
import {
  GENESIS_VAULT,
  V2_POOL_FEE_PERCENT,
  V2_REWARD_TOKEN,
  V2_STAKED_TOKEN,
  MULTICALL,
  WAD,
} from '../helpers/constants'
import { Multicall as MulticallContract, TryAggregateCallReturnDataStruct } from '../../generated/Keeper/Multicall'
import { isGnosisNetwork } from './network'
import { getUpdateStateCall } from './vaults'
import { calculateAverage, getAggregateCall } from '../helpers/utils'

const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'
const poolId = '1'
const swapXdaiToGnoSelector = '0xb0d11302'
const poolRewardAssetsSelector = '0x18160ddd'
const poolPrincipalAssetsSelector = '0x18160ddd'
const poolPenaltyAssetsSelector = '0xe6af61c8'
const rewardPerTokenSelector = '0xcd3daf9d'

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
    pool.apys = []
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

export function updatePoolApy(
  pool: V2Pool,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  rateChange: BigInt,
): void {
  if (fromTimestamp === null) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  if (totalDuration.isZero()) {
    log.error('[V2Pool] updatePoolApy totalDuration is zero fromTimestamp={} toTimestamp={}', [
      fromTimestamp.toString(),
      toTimestamp.toString(),
    ])
    return
  }
  const currentApy = new BigDecimal(rateChange)
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(BigDecimal.fromString(WAD))
    .div(new BigDecimal(totalDuration))

  let apys = pool.apys
  apys.push(currentApy)
  if (apys.length > snapshotsPerWeek) {
    apys = apys.slice(apys.length - snapshotsPerWeek)
  }
  pool.apys = apys
  pool.apy = calculateAverage(apys)
}

export function getPoolStateUpdate(
  rewardsRoot: Bytes,
  reward: BigInt,
  unlockedMevReward: BigInt,
  proof: Array<Bytes>,
): Array<BigInt> {
  const isGnosis = isGnosisNetwork()
  const rewardAssetsCall = Bytes.fromHexString(poolRewardAssetsSelector)
  const principalAssetsCall = Bytes.fromHexString(poolPrincipalAssetsSelector)
  const penaltyAssetsCall = Bytes.fromHexString(poolPenaltyAssetsSelector)
  const rewardPerTokenCall = Bytes.fromHexString(rewardPerTokenSelector)
  const updateStateCall = getUpdateStateCall(rewardsRoot, reward, unlockedMevReward, proof)
  const swapXdaiToGnoCall = Bytes.fromHexString(swapXdaiToGnoSelector)

  const multicallContract = MulticallContract.bind(Address.fromString(MULTICALL))
  let calls: Array<ethereum.Value> = [getAggregateCall(GENESIS_VAULT, updateStateCall)]
  if (isGnosis) {
    calls.push(getAggregateCall(GENESIS_VAULT, swapXdaiToGnoCall))
  }
  calls.push(getAggregateCall(V2_REWARD_TOKEN, rewardAssetsCall))
  calls.push(getAggregateCall(V2_REWARD_TOKEN, penaltyAssetsCall))
  calls.push(getAggregateCall(V2_STAKED_TOKEN, principalAssetsCall))
  calls.push(getAggregateCall(V2_REWARD_TOKEN, rewardPerTokenCall))

  const result = multicallContract.call('tryAggregate', 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])', [
    ethereum.Value.fromBoolean(false),
    ethereum.Value.fromArray(calls),
  ])
  let resultValue = result[0].toTupleArray<TryAggregateCallReturnDataStruct>()
  if (!resultValue[0].success) {
    log.error('[Vault] getPoolStateUpdate failed updateStateCall={}', [updateStateCall.toHexString()])
    assert(false, 'getPoolLatestRate failed')
  }

  if (isGnosis) {
    resultValue = resultValue.slice(2)
  } else {
    resultValue = resultValue.slice(1)
  }
  const rewardAssets = ethereum.decode('uint256', resultValue[0].returnData)!.toBigInt()
  const penaltyAssets = ethereum.decode('uint256', resultValue[1].returnData)!.toBigInt()
  const principalAssets = ethereum.decode('uint256', resultValue[2].returnData)!.toBigInt()
  const rewardRate = ethereum.decode('uint256', resultValue[3].returnData)!.toBigInt()
  const totalAssets = principalAssets.plus(rewardAssets)
  let penaltyRate = BigInt.zero()
  if (totalAssets.gt(BigInt.zero())) {
    penaltyRate = BigInt.fromString(WAD).times(penaltyAssets).div(totalAssets)
  }
  const newRate = BigInt.fromString(WAD).plus(rewardRate).minus(penaltyRate)
  return [newRate, rewardAssets, principalAssets, penaltyAssets]
}
