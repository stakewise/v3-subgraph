import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  ethereum,
  ipfs,
  json,
  JSONValueKind,
  log,
  store,
} from '@graphprotocol/graph-ts'
import {
  Allocator,
  Distributor,
  DistributorClaim,
  DistributorReward,
  ExchangeRate,
  Network,
  PeriodicDistribution,
  UniswapPool,
  UniswapPosition,
  UserIsContract,
  Vault,
} from '../../generated/schema'
import { Safe as SafeContract } from '../../generated/MerkleDistributor/Safe'
import { loadUniswapPool } from './uniswap'
import { ASSET_TOKEN, SWISE_TOKEN } from '../helpers/constants'
import { loadVault } from './vault'
import { createOrLoadAllocator, loadAllocator } from './allocator'
import { convertTokenAmountToAssets, getSupportedTokens } from './exchangeRates'
import { loadLeverageStrategyPosition } from './leverageStrategy'
import { JSONValue } from '@graphprotocol/graph-ts/common/value'

const distributorId = '1'
const secondsInYear = '31536000'
const maxPercent = '100'

export enum DistributionType {
  VAULT,
  SWISE_ASSET_UNI_POOL,
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

  const assetToken = Address.fromString(ASSET_TOKEN)
  if (
    (uniPool.token0.equals(SWISE_TOKEN) || uniPool.token1.equals(SWISE_TOKEN)) &&
    (uniPool.token0.equals(assetToken) || uniPool.token1.equals(assetToken))
  ) {
    return DistributionType.SWISE_ASSET_UNI_POOL
  }

  return DistributionType.UNKNOWN
}

export function convertDistributionTypeToString(distType: DistributionType): string {
  if (distType == DistributionType.VAULT) {
    return 'VAULT'
  }
  if (distType == DistributionType.SWISE_ASSET_UNI_POOL) {
    return 'SWISE_ASSET_UNI_POOL'
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
  return DistributionType.UNKNOWN
}

export function updatePeriodicDistributions(
  network: Network,
  exchangeRate: ExchangeRate,
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
    let distributedAssets: BigInt
    const distType = convertStringToDistributionType(dist.distributionType)

    if (distType == DistributionType.VAULT) {
      const vault = loadVault(Address.fromBytes(dist.data))
      if (!vault) {
        log.error('[MerkleDistributor] updateDistributions vault not found for id={}', [dist.id])
        continue
      }
      const token = Address.fromBytes(dist.token)

      distributedAmount = dist.amount.times(passedDuration).div(totalDuration)
      principalAssets = distributeToVaultUsers(network, vault, token, distributedAmount)
      distributedAssets = convertTokenAmountToAssets(exchangeRate, Address.fromBytes(dist.token), distributedAmount)
    } else if (distType == DistributionType.SWISE_ASSET_UNI_POOL) {
      // dist data is the pool address
      const uniPool = loadUniswapPool(Address.fromBytes(dist.data))!
      distributedAmount = dist.amount.times(passedDuration).div(totalDuration)
      principalAssets = distributeToSwiseAssetUniPoolUsers(
        exchangeRate,
        uniPool,
        Address.fromBytes(dist.token),
        distributedAmount,
      )
      distributedAssets = convertTokenAmountToAssets(exchangeRate, Address.fromBytes(dist.token), distributedAmount)
    } else {
      assert(false, `Unknown distribution type=${dist.id}`)
      return
    }

    // update APY
    updatePeriodicDistributionApy(dist, distributedAssets, principalAssets, passedDuration)

    dist.amount = dist.amount.minus(distributedAmount)
    dist.startTimestamp = currentTimestamp
    dist.save()
    if (dist.startTimestamp.lt(dist.endTimestamp)) {
      newActiveDistIds.push(dist.id)
    }
  }

  // update new active distributions
  distributor.activeDistributionIds = newActiveDistIds
  distributor.save()
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

  distribution.apy = distributedAssets
    .toBigDecimal()
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(principalAssets.toBigDecimal())
    .div(totalDuration.toBigDecimal())
  distribution.save()
}

export function distributeToVaultUsers(network: Network, vault: Vault, token: Address, totalReward: BigInt): BigInt {
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
    // distribute to EOA users and to MetaVaults only
    if (_userIsContract(allocator.address) && !_isMetaVault(allocator.address)) {
      continue
    }
    const userAddress = Address.fromBytes(allocator.address)
    let userAssets = allocator.assets

    const boostPosition = loadLeverageStrategyPosition(vaultAddress, userAddress)
    if (boostPosition) {
      const boostAllocator = loadAllocator(Address.fromBytes(boostPosition.proxy), vaultAddress)!
      userAssets = userAssets.plus(boostAllocator.assets)
    }
    if (userAssets.le(BigInt.zero())) {
      continue
    }
    users.push(userAddress)
    vaults.push(vaultAddress)
    usersAssets.push(userAssets)
    totalAssets = totalAssets.plus(userAssets)
  }

  if (totalAssets.isZero()) {
    log.error('[MerkleDistributor] No users found for vault={}', [vault.id])
    return totalAssets
  }

  // distribute reward to the users
  _distributeReward(users, usersAssets, totalAssets, token, totalReward)

  // MetaVaults also redistribute rewards to their users
  _redistributeMetaVaultsRewards(network)

  return totalAssets
}

export function distributeToVaultSelectedUsers(
  network: Network,
  vault: Vault,
  token: Address,
  totalReward: BigInt,
  allocations: Array<JSONValue>,
  isBoostRefund: boolean,
): void {
  let totalDistributedAmount = BigInt.zero()
  for (let i = 0; i < allocations.length; i++) {
    const _userReward = allocations[i]
    if (_userReward.kind != JSONValueKind.OBJECT) {
      log.error('[MerkleDistributor] OneTimeDistributionAdded user data is not an object index={}', [i.toString()])
      continue
    }
    const userRewardData = _userReward.toObject()
    const _user = userRewardData.get('address')
    const _amount = userRewardData.get('amount')
    if (!_user || _user.kind != JSONValueKind.STRING || !_amount || _amount.kind != JSONValueKind.STRING) {
      log.error('[MerkleDistributor] OneTimeDistributionAdded user or amount is invalid for index={}', [i.toString()])
      continue
    }

    const user = Address.fromString(_user.toString())
    const amount = BigInt.fromString(_amount.toString())
    if (amount.lt(BigInt.zero())) {
      log.error('[MerkleDistributor] OneTimeDistributionAdded amount is negative for index={}', [i.toString()])
      continue
    }

    if (totalDistributedAmount.plus(amount).gt(totalReward)) {
      log.error(
        '[MerkleDistributor] OneTimeDistributionAdded total distributed amount is greater than total amount for index={}',
        [i.toString()],
      )
      break
    }
    totalDistributedAmount = totalDistributedAmount.plus(amount)

    const distributorReward = createOrLoadDistributorReward(token, user)
    distributorReward.cumulativeAmount = distributorReward.cumulativeAmount.plus(amount)
    distributorReward.save()

    if (isBoostRefund) {
      const allocator = createOrLoadAllocator(user, Address.fromString(vault.id))
      allocator._periodBoostEarnedOsTokenShares = allocator._periodBoostEarnedOsTokenShares.plus(amount)
      allocator.save()
    }
  }

  if (totalDistributedAmount.isZero()) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded no users found for vault={}', [vault.id])
    return
  }

  // MetaVaults also redistribute rewards to their users
  _redistributeMetaVaultsRewards(network)
}

export function distributeToSwiseAssetUniPoolUsers(
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
  _distributeReward(users, usersAssets, totalAssets, token, totalReward)

  return totalAssets
}

export function fetchRewardsData(rewardsIpfsHash: string): Array<JSONValue> | null {
  const ipfsHash = rewardsIpfsHash.trim()
  if (ipfsHash.length !== 46 && ipfsHash.length !== 52) {
    return null
  }

  let data: Bytes | null = ipfs.cat(ipfsHash)
  let tries = 10
  while (data === null && tries > 0) {
    log.warning('[MerkleDistributor] OneTimeDistributionAdded ipfs.cat failed for hash={}, retrying', [ipfsHash])
    data = ipfs.cat(rewardsIpfsHash)
    tries -= 1
  }
  if (data === null) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded ipfs.cat failed for hash={}', [ipfsHash])
    return null
  }

  const parsedData = json.fromBytes(data as Bytes)
  if (parsedData.kind != JSONValueKind.ARRAY) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded data is not an array for hash={}', [ipfsHash])
    return null
  }
  return parsedData.toArray()
}

function _redistributeMetaVaultsRewards(network: Network): void {
  const vaultIds = network.vaultIds
  const supportedTokens = getSupportedTokens()

  let hasDistributedToMetaVault = true
  while (hasDistributedToMetaVault) {
    hasDistributedToMetaVault = false

    for (let i = 0; i < vaultIds.length; i++) {
      const vault = loadVault(Address.fromString(vaultIds[i]))!
      if (!vault.isMetaVault) {
        continue
      }

      const vaultAddress = Address.fromString(vault.id)
      for (let j = 0; j < supportedTokens.length; j++) {
        const token = supportedTokens[j]
        const distRewardId = `${token.toHex()}-${vaultAddress.toHex()}`
        const distributorReward = DistributorReward.load(distRewardId)
        if (!distributorReward) {
          continue
        }
        store.remove('DistributorReward', distRewardId)

        const totalReward = distributorReward.cumulativeAmount
        if (totalReward.le(BigInt.zero())) {
          continue
        }
        hasDistributedToMetaVault = true
        distributeToVaultUsers(network, vault, token, totalReward)
      }
    }
  }
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
  let distributedAmount = BigInt.zero()
  for (let i = 0; i < users.length; i++) {
    const user = users[i]
    const userPoints = points[i]
    if (userPoints.le(BigInt.zero())) {
      continue
    }

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

function _isMetaVault(address: Bytes): boolean {
  let vault = loadVault(Address.fromBytes(address))
  if (vault) {
    return vault.isMetaVault
  }
  return false
}
