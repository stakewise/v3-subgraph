import { Address, BigDecimal, BigInt, store } from '@graphprotocol/graph-ts'
import { Aave, Network, OsToken, OsTokenConfig, Staker, Vault } from '../../generated/schema'
import { MAIN_META_VAULT, OS_TOKEN_REDEEMER, OS_TOKEN_VAULT_ESCROW } from '../helpers/constants'
import { getAnnualReward } from '../helpers/utils'
import { loadAllocator } from './allocator'
import { loadAave, loadAavePosition } from './aave'
import { getBoostPositionAnnualReward, loadLeverageStrategyPosition } from './leverageStrategy'
import { convertOsTokenSharesToAssets, loadOsToken, loadOsTokenHolder } from './osToken'
import { loadOsTokenConfig } from './osTokenConfig'
import { getVaultOsTokenMintApy, loadVault } from './vault'

const networkId = '0'

export const MAIN_META_VAULT_ADDRESS = Address.fromString(MAIN_META_VAULT)

export function loadStaker(stakerAddress: Address): Staker | null {
  return Staker.load(stakerAddress.toHex())
}

// system addresses that hold osToken shares or vault shares on behalf of the users
// must not be tracked as stakers as their holdings are already attributed to the users
export function isStakerAddressExcluded(stakerAddress: Address): boolean {
  if (stakerAddress.equals(Address.zero())) {
    return true
  }
  if (stakerAddress.equals(OS_TOKEN_VAULT_ESCROW) || stakerAddress.equals(OS_TOKEN_REDEEMER)) {
    return true
  }
  if (Vault.load(stakerAddress.toHex()) !== null) {
    return true
  }
  // every leverage strategy proxy has an AavePosition keyed by its address
  return loadAavePosition(stakerAddress) !== null
}

// syncs the staker of the main MetaVault ecosystem for the given address.
// NB! Must be called only after all the input entities (allocator, osToken holder,
// leverage strategy position) were saved to the store.
export function syncStaker(stakerAddress: Address): void {
  if (MAIN_META_VAULT_ADDRESS.equals(Address.zero()) || isStakerAddressExcluded(stakerAddress)) {
    return
  }
  const osToken = loadOsToken()
  if (osToken === null) {
    return
  }
  // the main MetaVault may not be created yet, the staker is then tracked from the osToken balance only
  const vault = loadVault(MAIN_META_VAULT_ADDRESS)
  const osTokenConfig = vault !== null ? loadOsTokenConfig(vault.osTokenConfig) : null
  updateStaker(osToken, loadAave(), vault, osTokenConfig, stakerAddress)
}

// syncs all the stakers. Must be called after the vaults, osToken, aave and
// leverage strategy positions were synced with the latest rewards.
export function syncStakers(network: Network, osToken: OsToken, aave: Aave | null): void {
  if (MAIN_META_VAULT_ADDRESS.equals(Address.zero())) {
    return
  }
  const vault = loadVault(MAIN_META_VAULT_ADDRESS)
  const osTokenConfig = vault !== null ? loadOsTokenConfig(vault.osTokenConfig) : null

  let staker: Staker
  const stakers: Array<Staker> = network.stakers.load()
  for (let i = 0; i < stakers.length; i++) {
    staker = stakers[i]
    updateStaker(osToken, aave, vault, osTokenConfig, Address.fromString(staker.id))
  }
}

export function updateStaker(
  osToken: OsToken,
  aave: Aave | null,
  vault: Vault | null,
  osTokenConfig: OsTokenConfig | null,
  stakerAddress: Address,
): void {
  const holder = loadOsTokenHolder(stakerAddress)
  const osTokenShares = holder !== null ? holder.balance : BigInt.zero()

  let stakedAssets = BigInt.zero()
  let exitingAssets = BigInt.zero()
  let vaultShares = BigInt.zero()
  let mintedOsTokenShares = BigInt.zero()
  let boostOsTokenShares = BigInt.zero()
  let boostAssets = BigInt.zero()
  if (vault !== null) {
    const vaultAddress = Address.fromString(vault.id)
    const allocator = loadAllocator(stakerAddress, vaultAddress)
    if (allocator !== null) {
      vaultShares = allocator.shares
      stakedAssets = allocator.assets
      exitingAssets = allocator.exitingAssets
      mintedOsTokenShares = allocator.mintedOsTokenShares
    }
    const boostPosition = loadLeverageStrategyPosition(vaultAddress, stakerAddress)
    if (boostPosition !== null) {
      boostOsTokenShares = boostPosition.osTokenShares.plus(boostPosition.exitingOsTokenShares)
      boostAssets = boostPosition.assets.plus(boostPosition.exitingAssets)
    }
  }

  const isEmpty =
    vaultShares.isZero() &&
    stakedAssets.isZero() &&
    exitingAssets.isZero() &&
    mintedOsTokenShares.isZero() &&
    osTokenShares.isZero() &&
    boostOsTokenShares.isZero() &&
    boostAssets.isZero()
  if (isEmpty) {
    if (Staker.load(stakerAddress.toHex()) !== null) {
      store.remove('Staker', stakerAddress.toHex())
    }
    return
  }

  // the minted osToken shares must be burned to withdraw the staked assets.
  // The shares that are neither in the balance nor in the boost reduce the total assets
  // as the staker would have to buy them back at the current exchange rate.
  const netOsTokenShares = osTokenShares.plus(boostOsTokenShares).minus(mintedOsTokenShares)
  const netOsTokenAssets = _convertSignedOsTokenSharesToAssets(osToken, netOsTokenShares)

  let totalAssets = stakedAssets.plus(exitingAssets).plus(boostAssets).plus(netOsTokenAssets)
  if (totalAssets.lt(BigInt.zero())) {
    totalAssets = BigInt.zero()
  }

  let staker = Staker.load(stakerAddress.toHex())
  if (staker === null) {
    staker = new Staker(stakerAddress.toHex())
    staker.network = networkId
  }
  staker.totalAssets = totalAssets
  staker.apy = _getStakerApy(
    osToken,
    aave,
    vault,
    osTokenConfig,
    stakerAddress,
    stakedAssets,
    mintedOsTokenShares,
    netOsTokenAssets,
    totalAssets,
  )
  staker.save()
}

function _getStakerApy(
  osToken: OsToken,
  aave: Aave | null,
  vault: Vault | null,
  osTokenConfig: OsTokenConfig | null,
  stakerAddress: Address,
  stakedAssets: BigInt,
  mintedOsTokenShares: BigInt,
  netOsTokenAssets: BigInt,
  totalAssets: BigInt,
): BigDecimal {
  if (totalAssets.le(BigInt.zero())) {
    return BigDecimal.zero()
  }

  // staked assets earn vault APY
  let totalEarnedAssets = vault !== null ? getAnnualReward(stakedAssets, vault.apy) : BigInt.zero()

  // minted osToken shares lose mint APY
  if (mintedOsTokenShares.gt(BigInt.zero()) && vault !== null && osTokenConfig !== null) {
    const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, mintedOsTokenShares)
    totalEarnedAssets = totalEarnedAssets.minus(
      getAnnualReward(mintedOsTokenAssets, getVaultOsTokenMintApy(osToken, osTokenConfig)),
    )
  }

  // boost earns vault APY on the proxy stake and loses mint and borrow APYs
  if (vault !== null && aave !== null && osTokenConfig !== null) {
    const boostPosition = loadLeverageStrategyPosition(Address.fromString(vault.id), stakerAddress)
    if (boostPosition !== null) {
      totalEarnedAssets = totalEarnedAssets.plus(
        getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, boostPosition),
      )
    }
  }

  // the net osToken shares earn osToken APY, the shares minted but not held lose osToken APY
  totalEarnedAssets = totalEarnedAssets.plus(_getSignedAnnualReward(netOsTokenAssets, osToken.apy))

  return totalEarnedAssets.divDecimal(totalAssets.toBigDecimal()).times(BigDecimal.fromString('100'))
}

function _convertSignedOsTokenSharesToAssets(osToken: OsToken, shares: BigInt): BigInt {
  if (shares.ge(BigInt.zero())) {
    return convertOsTokenSharesToAssets(osToken, shares)
  }
  return convertOsTokenSharesToAssets(osToken, shares.neg()).neg()
}

function _getSignedAnnualReward(principal: BigInt, apy: BigDecimal): BigInt {
  if (principal.ge(BigInt.zero())) {
    return getAnnualReward(principal, apy)
  }
  return getAnnualReward(principal.neg(), apy).neg()
}
