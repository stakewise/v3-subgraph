import { Address, BigDecimal, BigInt, Bytes, log } from '@graphprotocol/graph-ts'
import {
  Distributor,
  DistributorClaim,
  DistributorReward,
  LeverageStrategyPosition,
  Network,
  OsToken,
  PeriodicDistribution,
  UniswapPool,
  UniswapPosition,
} from '../../generated/schema'
import { loadUniswapPool, MAX_TICK, MIN_TICK } from './uniswap'
import { ASSET_TOKEN, OS_TOKEN, SWISE_TOKEN, USDC_TOKEN } from '../helpers/constants'
import { convertOsTokenSharesToAssets, getOsTokenApy } from './osToken'
import { loadVault } from './vault'
import { calculateAverage, getCompoundedApy } from '../helpers/utils'
import { loadAavePosition } from './aave'

const distributorId = '1'
const secondsInYear = '31536000'
const maxPercent = '100'
const snapshotsPerWeek = 168
const snapshotsPerDay = 24
const leverageStrategyDistAddress = Address.zero()

export enum DistributionType {
  SWISE_ASSET_UNI_POOL,
  OS_TOKEN_USDC_UNI_POOL,
  LEVERAGE_STRATEGY,
  UNKNOWN,
}

export function loadDistributor(): Distributor | null {
  return Distributor.load(distributorId)
}

export function createOrLoadDistributor(): Distributor {
  let distributor = Distributor.load(distributorId)
  if (distributor === null) {
    distributor = new Distributor(distributorId)
    distributor.activeDistributionIds = []
    distributor.save()
  }

  return distributor
}

export function createOrLoadDistributorReward(token: Address, user: Address): DistributorReward {
  const distRewardId = `${token.toHex()}-${user.toHex()}`
  let distributorReward = DistributorReward.load(distRewardId)
  if (distributorReward === null) {
    distributorReward = new DistributorReward(distRewardId)
    distributorReward.user = user
    distributorReward.token = token
    distributorReward.cumulativeAmount = BigInt.zero()
    distributorReward.save()
  }

  return distributorReward
}

export function createOrLoadDistributorClaim(user: Address): DistributorClaim {
  let claim = DistributorClaim.load(user.toHex())
  if (claim === null) {
    claim = new DistributorClaim(user.toHex())
    claim.user = user
    claim.tokens = []
    claim.cumulativeAmounts = []
    claim.unclaimedAmounts = []
    claim.proof = []
    claim.save()
  }

  return claim
}

export function loadDistributorClaim(user: Address): DistributorClaim | null {
  return DistributorClaim.load(user.toHex())
}

export function getDistributionType(distData: Bytes): DistributionType {
  // only passed addresses are currently supported
  const distAddress = Address.fromBytes(distData)
  if (distAddress.equals(leverageStrategyDistAddress)) {
    return DistributionType.LEVERAGE_STRATEGY
  }
  const uniPool = loadUniswapPool(distAddress)
  if (uniPool == null) {
    return DistributionType.UNKNOWN
  }

  const usdcToken = Address.fromString(USDC_TOKEN)
  const assetToken = Address.fromString(ASSET_TOKEN)
  if (
    (uniPool.token0.equals(SWISE_TOKEN) || uniPool.token1.equals(SWISE_TOKEN)) &&
    (uniPool.token0.equals(assetToken) || uniPool.token1.equals(assetToken))
  ) {
    return DistributionType.SWISE_ASSET_UNI_POOL
  } else if (
    (uniPool.token0.equals(OS_TOKEN) || uniPool.token1.equals(OS_TOKEN)) &&
    (uniPool.token0.equals(usdcToken) || uniPool.token1.equals(usdcToken))
  ) {
    return DistributionType.OS_TOKEN_USDC_UNI_POOL
  }

  return DistributionType.UNKNOWN
}

export function getPeriodicDistributionApy(
  distribution: PeriodicDistribution,
  osToken: OsToken,
  useDayApy: boolean,
): BigDecimal {
  // assumes that updates happen every hour
  const apysCount = distribution.apys.length
  let apy: BigDecimal
  if (!useDayApy || apysCount < snapshotsPerDay) {
    apy = distribution.apy
  } else {
    const apys: Array<BigDecimal> = distribution.apys
    apy = calculateAverage(apys.slice(apysCount - snapshotsPerDay))
  }

  if (Address.fromBytes(distribution.token).equals(OS_TOKEN)) {
    // earned osToken shares earn extra staking rewards, apply compounding
    return getCompoundedApy(apy, getOsTokenApy(osToken, useDayApy))
  }
  return apy
}

export function convertDistributionTypeToString(distType: DistributionType): string {
  if (distType == DistributionType.SWISE_ASSET_UNI_POOL) {
    return 'SWISE_ASSET_UNI_POOL'
  }
  if (distType == DistributionType.OS_TOKEN_USDC_UNI_POOL) {
    return 'OS_TOKEN_USDC_UNI_POOL'
  }
  if (distType == DistributionType.LEVERAGE_STRATEGY) {
    return 'LEVERAGE_STRATEGY'
  }
  return 'UNKNOWN'
}

export function convertStringToDistributionType(distTypeString: string): DistributionType {
  if (distTypeString == 'SWISE_ASSET_UNI_POOL') {
    return DistributionType.SWISE_ASSET_UNI_POOL
  }
  if (distTypeString == 'OS_TOKEN_USDC_UNI_POOL') {
    return DistributionType.OS_TOKEN_USDC_UNI_POOL
  }
  if (distTypeString == 'LEVERAGE_STRATEGY') {
    return DistributionType.LEVERAGE_STRATEGY
  }
  return DistributionType.UNKNOWN
}

export function updateDistributions(
  network: Network,
  osToken: OsToken,
  distributor: Distributor,
  currentTimestamp: BigInt,
): void {
  const activeDistIds = distributor.activeDistributionIds
  if (activeDistIds.length == 0) {
    return
  }

  const newActiveDistIds: Array<string> = []

  let dist: PeriodicDistribution
  for (let i = 0; i < activeDistIds.length; i++) {
    dist = PeriodicDistribution.load(activeDistIds[i])!
    if (dist.startTimestamp.ge(currentTimestamp)) {
      // distribution hasn't started
      newActiveDistIds.push(dist.id)
      continue
    }

    // calculate amount to distribute
    const totalDuration = dist.endTimestamp.minus(dist.startTimestamp)
    let passedDuration = currentTimestamp.minus(dist.startTimestamp)
    if (passedDuration.gt(totalDuration)) {
      passedDuration = totalDuration
    }
    const amountToDistribute = dist.amount.times(passedDuration).div(totalDuration)

    // distribute tokens
    let principalUsdAssets: BigInt
    const distType = convertStringToDistributionType(dist.distributionType)
    if (distType == DistributionType.SWISE_ASSET_UNI_POOL) {
      // dist data is the pool address
      const uniPool = loadUniswapPool(Address.fromBytes(dist.data))!
      principalUsdAssets = distributeToSwiseAssetUniPoolUsers(
        network,
        uniPool,
        Address.fromBytes(dist.token),
        amountToDistribute,
      )
    } else if (distType == DistributionType.OS_TOKEN_USDC_UNI_POOL) {
      // dist data is the pool address
      const uniPool = loadUniswapPool(Address.fromBytes(dist.data))!
      principalUsdAssets = distributeToOsTokenUsdcUniPoolUsers(
        network,
        osToken,
        uniPool,
        Address.fromBytes(dist.token),
        amountToDistribute,
      )
    } else if (distType == DistributionType.LEVERAGE_STRATEGY) {
      principalUsdAssets = distributeToLeverageStrategyUsers(
        network,
        osToken,
        Address.fromBytes(dist.token),
        amountToDistribute,
      )
    } else {
      log.error('[MerkleDistributor] Unknown periodic distribution={}', [dist.id])
      continue
    }

    if (principalUsdAssets.isZero()) {
      log.error('[MerkleDistributor] Failed to distribute tokens for periodic distribution={}', [dist.id])
      continue
    }

    // calculate APY
    let distributedUsdAssets: BigInt = BigInt.zero()
    if (dist.token.equals(OS_TOKEN)) {
      distributedUsdAssets = convertOsTokenSharesToAssets(osToken, amountToDistribute)
        .toBigDecimal()
        .times(network.assetsUsdRate)
        .truncate(0).digits
    } else if (dist.token.equals(SWISE_TOKEN)) {
      distributedUsdAssets = amountToDistribute.toBigDecimal().times(network.swiseUsdRate).truncate(0).digits
    } else {
      log.error('[MerkleDistributor] Unknown token={} price to update APY', [dist.token.toHex()])
    }

    // update distribution
    updatePeriodicDistributionApy(dist, distributedUsdAssets, principalUsdAssets, passedDuration)
    dist.amount = dist.amount.minus(amountToDistribute)
    dist.startTimestamp = currentTimestamp
    dist.save()
    if (dist.startTimestamp < dist.endTimestamp) {
      newActiveDistIds.push(dist.id)
    }
  }

  // update new active distributions
  distributor.activeDistributionIds = newActiveDistIds
  distributor.save()
  log.info('[MerkleDistributor] Distributions updated timestamp={}', [currentTimestamp.toString()])
}

export function updatePeriodicDistributionApy(
  distribution: PeriodicDistribution,
  distributedUsdAssets: BigInt,
  principalUsdAssets: BigInt,
  totalDuration: BigInt,
): void {
  const zero = BigInt.zero()
  if (principalUsdAssets.le(zero) || distributedUsdAssets.le(zero) || totalDuration.le(zero)) {
    return
  }

  let apys = distribution.apys
  let currentApy = distributedUsdAssets
    .toBigDecimal()
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(principalUsdAssets.toBigDecimal())
    .div(totalDuration.toBigDecimal())

  apys.push(currentApy)

  // assumes that updates happen every hour
  if (apys.length > snapshotsPerWeek) {
    apys = apys.slice(apys.length - snapshotsPerWeek)
  }
  distribution.apys = apys
  distribution.apy = calculateAverage(apys)
  distribution.save()
}

export function distributeToSwiseAssetUniPoolUsers(
  network: Network,
  pool: UniswapPool,
  token: Address,
  totalReward: BigInt,
): BigInt {
  const swiseToken = SWISE_TOKEN
  const assetToken = Address.fromString(ASSET_TOKEN)
  const swiseUsdRate = network.swiseUsdRate
  const assetsUsdRate = network.assetsUsdRate
  if (
    (pool.token0.notEqual(swiseToken) && pool.token1.notEqual(assetToken)) ||
    (pool.token0.notEqual(assetToken) && pool.token1.notEqual(swiseToken))
  ) {
    assert(false, "Pool doesn't contain SWISE and ASSET tokens")
  }

  // calculate principals for all the users
  let uniPosition: UniswapPosition
  const uniPositions: Array<UniswapPosition> = pool.positions.load()
  let totalUsdAssets: BigInt = BigInt.zero()
  const users: Array<Address> = []
  const usersUsdAssets: Array<BigInt> = []
  for (let i = 0; i < uniPositions.length; i++) {
    uniPosition = uniPositions[i]
    if (uniPosition.tickLower != MIN_TICK && uniPosition.tickUpper != MAX_TICK) {
      // only full range positions receive incentives
      continue
    }
    const user = Address.fromBytes(uniPosition.owner)

    // calculate user USD assets
    let userUsdAssets: BigInt
    if (pool.token0.equals(assetToken)) {
      userUsdAssets = uniPosition.amount0
        .toBigDecimal()
        .times(assetsUsdRate)
        .plus(uniPosition.amount1.toBigDecimal().times(swiseUsdRate))
        .truncate(0).digits
    } else {
      userUsdAssets = uniPosition.amount1
        .toBigDecimal()
        .times(assetsUsdRate)
        .plus(uniPosition.amount0.toBigDecimal().times(swiseUsdRate))
        .truncate(0).digits
    }

    users.push(user)
    usersUsdAssets.push(userUsdAssets)
    totalUsdAssets = totalUsdAssets.plus(userUsdAssets)
  }

  // distribute reward to the users
  _distributeReward(users, usersUsdAssets, totalUsdAssets, token, totalReward)

  return totalUsdAssets
}

export function distributeToOsTokenUsdcUniPoolUsers(
  network: Network,
  osToken: OsToken,
  pool: UniswapPool,
  token: Address,
  totalReward: BigInt,
): BigInt {
  const usdcToken = Address.fromString(USDC_TOKEN)
  if (
    (pool.token0.notEqual(OS_TOKEN) && pool.token1.notEqual(usdcToken)) ||
    (pool.token0.notEqual(usdcToken) && pool.token1.notEqual(OS_TOKEN))
  ) {
    assert(false, "Pool doesn't contain USDC and OSTOKEN tokens")
  }
  const assetsUsdRate = network.assetsUsdRate
  const usdcUsdRate = network.usdcUsdRate

  // calculate points for all the users
  let uniPosition: UniswapPosition
  const uniPositions: Array<UniswapPosition> = pool.positions.load()
  let totalUsdAssets: BigInt = BigInt.zero()
  const users: Array<Address> = []
  const usersUsdAssets: Array<BigInt> = []
  for (let i = 0; i < uniPositions.length; i++) {
    uniPosition = uniPositions[i]
    if (!(uniPosition.tickLower <= pool.tick && uniPosition.tickUpper > pool.tick)) {
      // only in range positions receive incentives
      continue
    }
    const user = Address.fromBytes(uniPosition.owner)

    // calculate user USD assets
    let userUsdAssets: BigInt
    if (pool.token0.equals(OS_TOKEN)) {
      userUsdAssets = convertOsTokenSharesToAssets(osToken, uniPosition.amount0)
        .toBigDecimal()
        .times(assetsUsdRate)
        .plus(uniPosition.amount1.toBigDecimal().times(usdcUsdRate))
        .truncate(0).digits
    } else {
      userUsdAssets = convertOsTokenSharesToAssets(osToken, uniPosition.amount1)
        .toBigDecimal()
        .times(assetsUsdRate)
        .plus(uniPosition.amount0.toBigDecimal().times(usdcUsdRate))
        .truncate(0).digits
    }

    users.push(user)
    usersUsdAssets.push(userUsdAssets)
    totalUsdAssets = totalUsdAssets.plus(userUsdAssets)
  }

  // distribute reward to the users
  _distributeReward(users, usersUsdAssets, totalUsdAssets, token, totalReward)

  return totalUsdAssets
}

export function distributeToLeverageStrategyUsers(
  network: Network,
  osToken: OsToken,
  token: Address,
  totalReward: BigInt,
): BigInt {
  const assetsUsdRate = network.assetsUsdRate

  let position: LeverageStrategyPosition
  let totalUsdAssets: BigInt = BigInt.zero()
  const users: Array<Address> = []
  const usersUsdAssets: Array<BigInt> = []
  const vaultIds: Array<string> = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    const vault = loadVault(Address.fromString(vaultIds[i]))!
    const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
    for (let i = 0; i < leveragePositions.length; i++) {
      position = leveragePositions[i]
      const user = Address.fromBytes(position.user)

      // calculate user USD assets
      const aavePosition = loadAavePosition(Address.fromBytes(position.proxy))!
      let userUsdAssets: BigInt = convertOsTokenSharesToAssets(osToken, aavePosition.suppliedOsTokenShares)
        .toBigDecimal()
        .times(assetsUsdRate)
        .truncate(0).digits

      users.push(user)
      usersUsdAssets.push(userUsdAssets)
      totalUsdAssets = totalUsdAssets.plus(userUsdAssets)
    }
  }

  // distribute reward to the users
  _distributeReward(users, usersUsdAssets, totalUsdAssets, token, totalReward)

  return totalUsdAssets
}

function _distributeReward(
  users: Array<Address>,
  points: Array<BigInt>,
  totalPoints: BigInt,
  token: Address,
  totalReward: BigInt,
): void {
  if (totalPoints.le(BigInt.zero())) {
    return
  }
  let user: Address
  let userPoints: BigInt
  let distributedAmount = BigInt.zero()
  for (let i = 0; i < users.length; i++) {
    user = users[i]
    userPoints = points[i]

    let userReward: BigInt
    if (i == users.length - 1) {
      userReward = totalReward.minus(distributedAmount)
    } else {
      userReward = totalReward.times(userPoints).div(totalPoints)
    }
    distributedAmount = distributedAmount.plus(userReward)
    const distributorReward = createOrLoadDistributorReward(token, user)
    distributorReward.cumulativeAmount = distributorReward.cumulativeAmount.plus(userReward)
    distributorReward.save()
  }
}
