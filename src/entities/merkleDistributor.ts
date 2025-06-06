import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  Distributor,
  DistributorClaim,
  DistributorReward,
  ExchangeRate,
  LeverageStrategyPosition,
  Network,
  OsToken,
  PeriodicDistribution,
  UniswapPool,
  UniswapPosition,
  UserIsContract,
  Vault,
} from '../../generated/schema'
import { Safe as SafeContract } from '../../generated/PeriodicTasks/Safe'
import { loadUniswapPool } from './uniswap'
import { ASSET_TOKEN, OS_TOKEN, SWISE_TOKEN, USDC_TOKEN } from '../helpers/constants'
import { convertOsTokenSharesToAssets, getOsTokenApy } from './osToken'
import { getVaultApy, loadVault, snapshotVault } from './vault'
import { calculateAverage, getAnnualReward, getCompoundedApy } from '../helpers/utils'
import { loadAavePosition } from './aave'
import { createOrLoadAllocator, getAllocatorApy, loadAllocator } from './allocator'
import { convertTokenAmountToAssets } from './exchangeRates'
import { getOsTokenHolderVault, loadOsTokenHolder } from './osTokenHolder'
import { loadLeverageStrategyPosition } from './leverageStrategy'
import { loadOsTokenConfig } from './osTokenConfig'

const distributorId = '1'
const secondsInYear = '31536000'
const maxPercent = '100'
const snapshotsPerDay = 24
const snapshotsPerWeek = 168
const leverageStrategyDistAddress = Address.zero()

export enum DistributionType {
  VAULT,
  SWISE_ASSET_UNI_POOL,
  OS_TOKEN_USDC_UNI_POOL,
  LEVERAGE_STRATEGY,
  UNKNOWN,
}

export function loadDistributor(): Distributor | null {
  return Distributor.load(distributorId)
}

export function loadPeriodicDistribution(id: string): PeriodicDistribution | null {
  return PeriodicDistribution.load(id)
}

export function createOrLoadDistributor(): Distributor {
  let distributor = Distributor.load(distributorId)
  if (distributor === null) {
    distributor = new Distributor(distributorId)
    distributor.activeDistributionIds = []
    distributor.activeDistributors = []
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
  if (distData.length != 20) {
    const decodedData = ethereum.decode('(address,uint16)', distData)
    if (!decodedData) {
      return DistributionType.UNKNOWN
    }
    const decodedTuple = decodedData.toTuple()
    const distAddress = decodedTuple[0].toAddress()
    if (distAddress.equals(leverageStrategyDistAddress)) {
      return DistributionType.LEVERAGE_STRATEGY
    }
    return DistributionType.UNKNOWN
  }

  // only passed addresses are currently supported
  const distAddress = Address.fromBytes(distData)

  const vault = loadVault(distAddress)
  if (vault != null) {
    return DistributionType.VAULT
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

export function getLeverageStrategyTargetApy(distData: Bytes): BigDecimal {
  const tuple = ethereum.decode('(address,uint16)', distData)!.toTuple()
  return tuple[1].toBigInt().divDecimal(BigDecimal.fromString('100'))
}

export function getPeriodicDistributionApy(
  distribution: PeriodicDistribution,
  osToken: OsToken,
  useDayApy: boolean,
): BigDecimal {
  const apys: Array<BigDecimal> = distribution.apys

  let distApy = distribution.apy
  const apysCount = apys.length
  if (useDayApy && apysCount > snapshotsPerDay) {
    distApy = calculateAverage(apys.slice(apysCount - snapshotsPerDay))
  }

  if (Address.fromBytes(distribution.token).equals(OS_TOKEN)) {
    // earned osToken shares earn extra staking rewards, apply compounding
    return getCompoundedApy(distApy, getOsTokenApy(osToken, useDayApy))
  }
  return distApy
}

export function convertDistributionTypeToString(distType: DistributionType): string {
  if (distType == DistributionType.VAULT) {
    return 'VAULT'
  }
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
  if (distTypeString == 'VAULT') {
    return DistributionType.VAULT
  }
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
  exchangeRate: ExchangeRate,
  osToken: OsToken,
  distributor: Distributor,
  currentTimestamp: BigInt,
): void {
  const activeDistIds = distributor.activeDistributionIds
  if (activeDistIds.length == 0) {
    return
  }

  const newActiveDistIds: Array<string> = []

  for (let i = 0; i < activeDistIds.length; i++) {
    const dist = loadPeriodicDistribution(activeDistIds[i])!
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

    let distributedAmount: BigInt
    let principalAssets: BigInt
    const distType = convertStringToDistributionType(dist.distributionType)

    if (distType == DistributionType.VAULT) {
      const vault = loadVault(Address.fromBytes(dist.data))!
      const token = Address.fromBytes(dist.token)
      distributedAmount = dist.amount.times(passedDuration).div(totalDuration)
      principalAssets = distributeToVaultUsers(network, exchangeRate, vault, token, distributedAmount)
    } else if (distType == DistributionType.LEVERAGE_STRATEGY) {
      const targetApy = getLeverageStrategyTargetApy(dist.data)
      const response = distributeToLeverageStrategyUsers(network, exchangeRate, targetApy, passedDuration, dist.amount)
      distributedAmount = response[1]
      principalAssets = convertOsTokenSharesToAssets(osToken, response[0])
    } else if (distType == DistributionType.SWISE_ASSET_UNI_POOL) {
      // dist data is the pool address
      const uniPool = loadUniswapPool(Address.fromBytes(dist.data))!
      distributedAmount = dist.amount.times(passedDuration).div(totalDuration)
      principalAssets = distributeToSwiseAssetUniPoolUsers(
        network,
        exchangeRate,
        uniPool,
        Address.fromBytes(dist.token),
        distributedAmount,
      )
    } else if (distType == DistributionType.OS_TOKEN_USDC_UNI_POOL) {
      // dist data is the pool address
      const uniPool = loadUniswapPool(Address.fromBytes(dist.data))!
      distributedAmount = dist.amount.times(passedDuration).div(totalDuration)
      principalAssets = distributeToOsTokenUsdcUniPoolUsers(
        network,
        exchangeRate,
        uniPool,
        Address.fromBytes(dist.token),
        distributedAmount,
      )
    } else {
      assert(false, `Unknown distribution type=${dist.id}`)
      return
    }

    // update APY
    const distributedAssets = convertTokenAmountToAssets(exchangeRate, Address.fromBytes(dist.token), distributedAmount)
    updatePeriodicDistributionApy(dist, distributedAssets, principalAssets, passedDuration)

    if (dist.amount.equals(distributedAmount)) {
      // distribution is finished
      dist.endTimestamp = currentTimestamp
    }
    dist.amount = dist.amount.minus(distributedAmount)
    dist.startTimestamp = currentTimestamp
    dist.save()
    if (dist.startTimestamp < dist.endTimestamp) {
      newActiveDistIds.push(dist.id)
    }

    if (distType == DistributionType.VAULT) {
      const vault = loadVault(Address.fromBytes(dist.data))!
      vault.apy = getVaultApy(vault, distributor, osToken, false)
      vault.save()

      // update allocators
      const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
      let allocator: Allocator
      let allocators: Array<Allocator> = vault.allocators.load()
      for (let j = 0; j < allocators.length; j++) {
        allocator = allocators[j]
        allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator)
        allocator.save()
      }
      snapshotVault(loadVault(Address.fromBytes(dist.data))!, distributor, osToken, distributedAssets, currentTimestamp)
    }
  }

  // update new active distributions
  distributor.activeDistributionIds = newActiveDistIds
  distributor.save()
  log.info('[MerkleDistributor] Distributions updated timestamp={}', [currentTimestamp.toString()])
}

export function updatePeriodicDistributionApy(
  distribution: PeriodicDistribution,
  distributedAssets: BigInt,
  principalAssets: BigInt,
  totalDuration: BigInt,
): void {
  const zero = BigInt.zero()
  if (principalAssets.le(zero) || distributedAssets.le(zero) || totalDuration.le(zero)) {
    return
  }

  let apys = distribution.apys
  let currentApy = distributedAssets
    .toBigDecimal()
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(principalAssets.toBigDecimal())
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

export function distributeToVaultUsers(
  network: Network,
  exchangeRate: ExchangeRate,
  vault: Vault,
  token: Address,
  totalReward: BigInt,
): BigInt {
  let allocator: Allocator
  let totalAssets: BigInt = BigInt.zero()
  const allocators: Array<Allocator> = vault.allocators.load()

  // collect all the users and their assets
  const users: Array<Address> = []
  const vaults: Array<Address> = []
  const usersAssets: Array<BigInt> = []
  const vaultAddress = Address.fromString(vault.id)

  for (let i = 0; i < allocators.length; i++) {
    allocator = allocators[i]
    if (_userIsContract(allocator.address)) {
      continue
    }
    const userAddress = Address.fromBytes(allocator.address)
    let userAssets = allocator.assets

    const boostPosition = loadLeverageStrategyPosition(vaultAddress, userAddress)
    if (boostPosition) {
      const boostAllocator = loadAllocator(Address.fromBytes(boostPosition.proxy), vaultAddress)!
      userAssets = userAssets.plus(boostAllocator.assets)
    }
    users.push(userAddress)
    vaults.push(vaultAddress)
    usersAssets.push(userAssets)
    totalAssets = totalAssets.plus(userAssets)
  }

  // distribute reward to the users
  _distributeReward(network, exchangeRate, users, vaults, usersAssets, totalAssets, token, totalReward)

  return totalAssets
}

export function distributeToSwiseAssetUniPoolUsers(
  network: Network,
  exchangeRate: ExchangeRate,
  pool: UniswapPool,
  token: Address,
  totalReward: BigInt,
): BigInt {
  const swiseToken = SWISE_TOKEN
  const assetToken = Address.fromString(ASSET_TOKEN)
  if (
    (pool.token0.notEqual(swiseToken) || pool.token1.notEqual(assetToken)) &&
    (pool.token0.notEqual(assetToken) || pool.token1.notEqual(swiseToken))
  ) {
    assert(false, "Pool doesn't contain SWISE and ASSET tokens")
  }

  if (exchangeRate.assetsUsdRate.equals(BigDecimal.zero()) || exchangeRate.swiseUsdRate.equals(BigDecimal.zero())) {
    assert(false, 'Missing USD rates for OsToken or SWISE token')
  }

  // calculate principals for all the users
  let totalAssets: BigInt = BigInt.zero()
  const uniPositions: Array<UniswapPosition> = pool.positions.load()
  const users: Array<Address> = []
  const usersAssets: Array<BigInt> = []
  for (let i = 0; i < uniPositions.length; i++) {
    const uniPosition = uniPositions[i]
    if (uniPosition.tickLower > -887220 || uniPosition.tickUpper < 887220) {
      // only full range positions receive incentives
      continue
    }
    if (_userIsContract(uniPosition.owner)) {
      continue
    }
    const user = Address.fromBytes(uniPosition.owner)

    // calculate user assets
    const userAssets = convertTokenAmountToAssets(
      exchangeRate,
      Address.fromBytes(pool.token0),
      uniPosition.amount0,
    ).plus(convertTokenAmountToAssets(exchangeRate, Address.fromBytes(pool.token1), uniPosition.amount1))

    users.push(user)
    usersAssets.push(userAssets)
    totalAssets = totalAssets.plus(userAssets)
  }

  // distribute reward to the users
  _distributeReward(network, exchangeRate, users, [], usersAssets, totalAssets, token, totalReward)

  return totalAssets
}

export function distributeToOsTokenUsdcUniPoolUsers(
  network: Network,
  exchangeRate: ExchangeRate,
  pool: UniswapPool,
  token: Address,
  totalReward: BigInt,
): BigInt {
  const usdcToken = Address.fromString(USDC_TOKEN)
  if (
    (pool.token0.notEqual(OS_TOKEN) || pool.token1.notEqual(usdcToken)) &&
    (pool.token0.notEqual(usdcToken) || pool.token1.notEqual(OS_TOKEN))
  ) {
    assert(false, "Pool doesn't contain USDC and OsToken tokens")
  }
  if (exchangeRate.assetsUsdRate.equals(BigDecimal.zero()) || exchangeRate.usdcUsdRate.equals(BigDecimal.zero())) {
    assert(false, 'Missing USD rates for OsToken or USDC token')
  }

  // calculate points for all the users
  let totalAssets: BigInt = BigInt.zero()
  const uniPositions: Array<UniswapPosition> = pool.positions.load()
  const users: Array<Address> = []
  const usersAssets: Array<BigInt> = []
  for (let i = 0; i < uniPositions.length; i++) {
    const uniPosition = uniPositions[i]
    if (!(uniPosition.tickLower <= pool.tick && uniPosition.tickUpper > pool.tick)) {
      // only in range positions receive incentives
      continue
    }
    if (_userIsContract(uniPosition.owner)) {
      continue
    }
    const user = Address.fromBytes(uniPosition.owner)

    // calculate user assets
    const userAssets = convertTokenAmountToAssets(
      exchangeRate,
      Address.fromBytes(pool.token0),
      uniPosition.amount0,
    ).plus(convertTokenAmountToAssets(exchangeRate, Address.fromBytes(pool.token1), uniPosition.amount1))

    users.push(user)
    usersAssets.push(userAssets)
    totalAssets = totalAssets.plus(userAssets)
  }

  // distribute reward to the users
  _distributeReward(network, exchangeRate, users, [], usersAssets, totalAssets, token, totalReward)

  return totalAssets
}

export function distributeToLeverageStrategyUsers(
  network: Network,
  exchangeRate: ExchangeRate,
  targetApy: BigDecimal,
  totalDuration: BigInt,
  maxDistributedOsTokenShares: BigInt,
): Array<BigInt> {
  let position: LeverageStrategyPosition
  let totalOsTokenShares: BigInt = BigInt.zero()
  const users: Array<Address> = []
  const vaults: Array<Address> = []
  const usersOsTokenShares: Array<BigInt> = []
  const vaultIds: Array<string> = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    const vault = loadVault(Address.fromString(vaultIds[i]))!
    const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
    for (let i = 0; i < leveragePositions.length; i++) {
      position = leveragePositions[i]
      if (_userIsContract(position.user)) {
        continue
      }
      // calculate user principal
      const aavePosition = loadAavePosition(Address.fromBytes(position.proxy))!
      const user = Address.fromBytes(position.user)

      const userPrincipalOsTokenShares = aavePosition.suppliedOsTokenShares

      vaults.push(Address.fromString(vault.id))
      users.push(user)
      usersOsTokenShares.push(userPrincipalOsTokenShares)
      totalOsTokenShares = totalOsTokenShares.plus(userPrincipalOsTokenShares)
    }
  }

  // calculate total reward
  let distributedPeriodOsTokenShares = getAnnualReward(totalOsTokenShares, targetApy)
    .div(BigInt.fromString(secondsInYear))
    .times(totalDuration)

  if (distributedPeriodOsTokenShares.gt(maxDistributedOsTokenShares)) {
    distributedPeriodOsTokenShares = maxDistributedOsTokenShares
  }

  // distribute reward to the users
  _distributeReward(
    network,
    exchangeRate,
    users,
    vaults,
    usersOsTokenShares,
    totalOsTokenShares,
    OS_TOKEN,
    distributedPeriodOsTokenShares,
  )

  return [totalOsTokenShares, distributedPeriodOsTokenShares]
}

function _distributeReward(
  network: Network,
  exchangeRate: ExchangeRate,
  users: Array<Address>,
  vaults: Array<Address>,
  points: Array<BigInt>,
  totalPoints: BigInt,
  token: Address,
  totalReward: BigInt,
): void {
  if (totalPoints.le(BigInt.zero())) {
    return
  }
  let distributedAmount = BigInt.zero()
  for (let i = 0; i < users.length; i++) {
    const user = users[i]
    const userPoints = points[i]

    let userReward: BigInt
    if (i == users.length - 1) {
      userReward = totalReward.minus(distributedAmount)
    } else {
      userReward = totalReward.times(userPoints).div(totalPoints)
    }
    if (userReward.le(BigInt.zero())) {
      continue
    }

    distributedAmount = distributedAmount.plus(userReward)
    const distributorReward = createOrLoadDistributorReward(token, user)
    distributorReward.cumulativeAmount = distributorReward.cumulativeAmount.plus(userReward)
    distributorReward.save()

    if (vaults.length == 0) {
      continue
    }

    const vault = vaults[i]
    const userRewardAssets = convertTokenAmountToAssets(exchangeRate, token, userReward)
    const allocator = createOrLoadAllocator(user, vault)
    allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(userRewardAssets)
    allocator.save()

    const osTokenHolder = loadOsTokenHolder(user)
    if (!osTokenHolder) {
      continue
    }
    const osTokenVault = getOsTokenHolderVault(network, osTokenHolder)
    if (osTokenVault && osTokenVault.equals(vault)) {
      osTokenHolder._periodEarnedAssets = osTokenHolder._periodEarnedAssets.plus(userRewardAssets)
      osTokenHolder.save()
    }
  }
}

function _userIsContract(address: Bytes): boolean {
  let cache = UserIsContract.load(address)
  if (cache) {
    return cache.isContract
  }

  let isContract = ethereum.hasCode(Address.fromBytes(address)).inner
  if (isContract) {
    const safeVersion = SafeContract.bind(Address.fromBytes(address)).try_VERSION()
    if (!safeVersion.reverted && safeVersion.value != '') {
      // treat Safe contract as a user
      isContract = false
    }
  }
  cache = new UserIsContract(address)
  cache.isContract = isContract
  cache.save()
  return cache.isContract
}
