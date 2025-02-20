import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { V2Pool, V2PoolUser, Vault } from '../../generated/schema'
import { V2_POOL_FEE_PERCENT, V2_REWARD_TOKEN, V2_STAKED_TOKEN, WAD } from '../helpers/constants'
import { calculateAverage, chunkedMulticall } from '../helpers/utils'
import { getUpdateStateCall } from './vault'

const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'
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
  let currentApy = new BigDecimal(rateChange)
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(BigDecimal.fromString(WAD))
    .div(new BigDecimal(totalDuration))

  if (pool.totalAssets.gt(BigInt.zero())) {
    // the rate change is calculated as if only the principal assets were staked
    // we need to include the reward assets as well
    currentApy = currentApy.times(pool.principalAssets.toBigDecimal()).div(pool.totalAssets.toBigDecimal())
  }

  let apys = pool.apys
  apys.push(currentApy)
  if (apys.length > snapshotsPerWeek) {
    apys = apys.slice(apys.length - snapshotsPerWeek)
  }
  pool.apys = apys
  pool.apy = calculateAverage(apys)
}

export function getV2PoolState(vault: Vault): Array<BigInt> {
  const rewardAssetsCall = Bytes.fromHexString(poolRewardAssetsSelector)
  const principalAssetsCall = Bytes.fromHexString(poolPrincipalAssetsSelector)
  const penaltyAssetsCall = Bytes.fromHexString(poolPenaltyAssetsSelector)
  const rewardPerTokenCall = Bytes.fromHexString(rewardPerTokenSelector)
  const updateStateCall = getUpdateStateCall(vault)
  const vaultAddress = Address.fromString(vault.id)
  const wad = BigInt.fromString(WAD)

  const contractAddresses: Array<Address> = []
  let contractCalls: Array<Bytes> = []
  if (updateStateCall) {
    contractAddresses.push(vaultAddress)
    contractCalls.push(updateStateCall)
  }
  contractAddresses.push(V2_REWARD_TOKEN)
  contractCalls.push(rewardAssetsCall)

  contractAddresses.push(V2_REWARD_TOKEN)
  contractCalls.push(penaltyAssetsCall)

  contractAddresses.push(V2_STAKED_TOKEN)
  contractCalls.push(principalAssetsCall)

  contractAddresses.push(V2_REWARD_TOKEN)
  contractCalls.push(rewardPerTokenCall)

  let results = chunkedMulticall(contractAddresses, contractCalls, false)
  if (updateStateCall) {
    // check whether update state call succeeded
    if (results[0] === null) {
      log.error('[Vault] getV2PoolState failed updateStateCall={}', [updateStateCall.toHexString()])
      assert(false, 'getV2PoolState failed')
    }
    results = results.slice(1)
  }

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
