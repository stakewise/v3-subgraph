import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { Distributor, DistributorReward, UniswapPool, UniswapPosition, DistributorClaim } from '../../generated/schema'
import { MAX_TICK, MIN_TICK } from './uniswap'
import { createOrLoadNetwork } from './network'
import { ASSET_TOKEN, OS_TOKEN, SWISE_TOKEN, USDC_TOKEN } from '../helpers/constants'
import { convertOsTokenSharesToAssets, createOrLoadOsToken } from './osToken'

const distributorId = '1'
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
    distributorReward = new DistributorReward(distributorId)
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
    claim = new DistributorClaim(distributorId)
    claim.user = user
    claim.tokens = []
    claim.cumulativeAmounts = []
    claim.unclaimedAmounts = []
    claim.proof = []
    claim.save()
  }

  return claim
}

export function distributeToSwiseAssetUniPoolUsers(pool: UniswapPool, token: Address, totalReward: BigInt): void {
  const swiseToken = SWISE_TOKEN
  const assetToken = Address.fromString(ASSET_TOKEN)
  if (
    (pool.token0.notEqual(swiseToken) && pool.token1.notEqual(assetToken)) ||
    (pool.token0.notEqual(assetToken) && pool.token1.notEqual(swiseToken))
  ) {
    assert(false, "Pool doesn't contain SWISE and ASSET tokens")
  }

  // calculate points for all the users
  let uniPosition: UniswapPosition
  const uniPositions: Array<UniswapPosition> = pool.positions.load()
  let totalPoints: BigInt = BigInt.zero()
  const points: Array<BigInt> = []
  const users: Array<Address> = []
  for (let i = 0; i < uniPositions.length; i++) {
    uniPosition = uniPositions[i]
    if (uniPosition.tickLower != MIN_TICK && uniPosition.tickUpper != MAX_TICK) {
      // only full range positions receive points
      continue
    }
    points.push(uniPosition.liquidity)
    users.push(Address.fromBytes(uniPosition.owner))
    totalPoints = totalPoints.plus(uniPosition.liquidity)
  }

  // distribute reward to the users
  _distributeReward(users, points, totalPoints, token, totalReward)
}

export function distributeToOsTokenUsdcUniPoolUsers(pool: UniswapPool, token: Address, totalReward: BigInt): void {
  const usdcToken = Address.fromString(USDC_TOKEN)
  if (
    (pool.token0.notEqual(OS_TOKEN) && pool.token1.notEqual(usdcToken)) ||
    (pool.token0.notEqual(usdcToken) && pool.token1.notEqual(OS_TOKEN))
  ) {
    assert(false, "Pool doesn't contain USDC and OSTOKEN tokens")
  }
  const network = createOrLoadNetwork()
  const osToken = createOrLoadOsToken()
  const assetsUsdRate = network.assetsUsdRate
  const usdcUsdRate = network.usdcUsdRate

  // calculate points for all the users
  let uniPosition: UniswapPosition
  const uniPositions: Array<UniswapPosition> = pool.positions.load()
  let totalPoints: BigInt = BigInt.zero()
  const points: Array<BigInt> = []
  const users: Array<Address> = []
  for (let i = 0; i < uniPositions.length; i++) {
    uniPosition = uniPositions[i]
    if (!(uniPosition.tickLower <= pool.tick && uniPosition.tickUpper > pool.tick)) {
      // only in range positions receive points
      continue
    }

    let userPoints = BigDecimal.zero()
    if (pool.token0.equals(OS_TOKEN)) {
      userPoints = new BigDecimal(convertOsTokenSharesToAssets(osToken, uniPosition.amount0)).times(assetsUsdRate)
    } else if (pool.token1.equals(OS_TOKEN)) {
      userPoints = new BigDecimal(convertOsTokenSharesToAssets(osToken, uniPosition.amount1)).times(assetsUsdRate)
    }
    if (pool.token0.equals(usdcToken)) {
      userPoints = userPoints.plus(new BigDecimal(uniPosition.amount0).times(usdcUsdRate))
    } else if (pool.token1.equals(usdcToken)) {
      userPoints = userPoints.plus(new BigDecimal(uniPosition.amount1).times(usdcUsdRate))
    }

    points.push(userPoints.digits)
    users.push(Address.fromBytes(uniPosition.owner))
    totalPoints = totalPoints.plus(userPoints.digits)
  }

  // distribute reward to the users
  _distributeReward(users, points, totalPoints, token, totalReward)
}

function _distributeReward(
  users: Array<Address>,
  points: Array<BigInt>,
  totalPoints: BigInt,
  token: Address,
  totalReward: BigInt,
): void {
  let distributedAmount = BigInt.zero()
  for (let i = 0; i < users.length; i++) {
    let userReward: BigInt
    if (i == users.length - 1) {
      userReward = totalReward.minus(distributedAmount)
    } else {
      userReward = totalReward.times(points[i]).div(totalPoints)
    }
    distributedAmount = distributedAmount.plus(userReward)
    const distributorReward = createOrLoadDistributorReward(token, users[i])
    distributorReward.cumulativeAmount = distributorReward.cumulativeAmount.plus(userReward)
    distributorReward.save()
  }
}
