import { Address, BigDecimal, BigInt, Bytes } from '@graphprotocol/graph-ts'
import {
  Aave,
  LeverageStrategyPosition,
  Network,
  OsToken,
  OsTokenConfig,
  Staker,
  StakerSnapshot,
  Vault,
} from '../../generated/schema'
import {
  AAVE_LEVERAGE_STRATEGY_V1,
  AAVE_LEVERAGE_STRATEGY_V2,
  MAIN_META_VAULT,
  OS_TOKEN_REDEEMER,
  OS_TOKEN_VAULT_ESCROW,
} from '../helpers/constants'
import { calculateApy, getAnnualReward, getSnapshotTimestamp } from '../helpers/utils'
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
  if (stakerAddress.equals(AAVE_LEVERAGE_STRATEGY_V1) || stakerAddress.equals(AAVE_LEVERAGE_STRATEGY_V2)) {
    return true
  }
  if (Vault.load(stakerAddress.toHex()) !== null) {
    return true
  }
  // every leverage strategy proxy has an AavePosition keyed by its address
  return loadAavePosition(stakerAddress) !== null
}

// syncs the staker of the main MetaVault ecosystem for the given address.
// flowAssets is the assets value the triggering event moved in (+) or out (-) of the
// staker's tracked position — it is excluded from the snapshot earnings.
// NB! Must be called only after all the input entities (allocator, osToken holder,
// leverage strategy position) were saved to the store.
export function syncStaker(stakerAddress: Address, flowAssets: BigInt = BigInt.zero()): void {
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
  updateStaker(osToken, loadAave(), vault, osTokenConfig, stakerAddress, flowAssets)
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
    if (_isStakerEmptied(staker)) {
      continue
    }
    updateStaker(osToken, aave, vault, osTokenConfig, Address.fromString(staker.id))
  }
}

export function updateStaker(
  osToken: OsToken,
  aave: Aave | null,
  vault: Vault | null,
  osTokenConfig: OsTokenConfig | null,
  stakerAddress: Address,
  flowAssets: BigInt = BigInt.zero(),
): Staker | null {
  const holder = loadOsTokenHolder(stakerAddress)
  const osTokenShares = holder !== null ? holder.balance : BigInt.zero()

  let stakedAssets = BigInt.zero()
  let exitingAssets = BigInt.zero()
  let vaultShares = BigInt.zero()
  let mintedOsTokenShares = BigInt.zero()
  let boostOsTokenShares = BigInt.zero()
  let boostAssets = BigInt.zero()
  let boostPosition: LeverageStrategyPosition | null = null
  if (vault !== null) {
    const vaultAddress = Address.fromString(vault.id)
    const allocator = loadAllocator(stakerAddress, vaultAddress)
    if (allocator !== null) {
      vaultShares = allocator.shares
      stakedAssets = allocator.assets
      exitingAssets = allocator.exitingAssets
      mintedOsTokenShares = allocator.mintedOsTokenShares
    }
    boostPosition = loadLeverageStrategyPosition(vaultAddress, stakerAddress)
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

  let staker = Staker.load(stakerAddress.toHex())
  if (staker === null) {
    // stakers are kept forever once created so that the snapshots don't dangle
    if (isEmpty) {
      return null
    }
    staker = new Staker(stakerAddress.toHex())
    staker.network = networkId
    staker.totalEarnedAssets = BigInt.zero()
    staker._periodFlowAssets = BigInt.zero()
    staker._prevSnapshotTotalAssets = BigInt.zero()
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

  staker._periodFlowAssets = staker._periodFlowAssets.plus(flowAssets)
  staker.totalAssets = totalAssets
  staker.apy = _getStakerApy(
    osToken,
    aave,
    vault,
    osTokenConfig,
    boostPosition,
    stakedAssets,
    mintedOsTokenShares,
    netOsTokenAssets,
    totalAssets,
  )
  staker.save()
  return staker
}

// creates the daily snapshots for all the stakers. Must be called with the same
// duration and timestamp as the vault and allocator snapshots.
export function snapshotStakers(
  network: Network,
  osToken: OsToken,
  aave: Aave | null,
  duration: BigInt,
  timestamp: i64,
): void {
  if (MAIN_META_VAULT_ADDRESS.equals(Address.zero())) {
    return
  }
  const vault = loadVault(MAIN_META_VAULT_ADDRESS)
  const osTokenConfig = vault !== null ? loadOsTokenConfig(vault.osTokenConfig) : null

  const stakers: Array<Staker> = network.stakers.load()
  for (let i = 0; i < stakers.length; i++) {
    // skip the stakers that had no assets for the whole period
    if (_isStakerEmptied(stakers[i])) {
      continue
    }
    // refresh the staker so the period earnings do not smear across the snapshot boundary
    const staker = updateStaker(osToken, aave, vault, osTokenConfig, Address.fromString(stakers[i].id))
    if (staker === null) {
      continue
    }
    createStakerSnapshot(staker, duration, timestamp)
  }
}

// an emptied staker cannot change without its own event, so the global passes skip it.
// NB! A position clamped to zero totalAssets is also skipped until its next event.
function _isStakerEmptied(staker: Staker): boolean {
  return staker.totalAssets.isZero() && staker._prevSnapshotTotalAssets.isZero() && staker._periodFlowAssets.isZero()
}

export function createStakerSnapshot(staker: Staker, duration: BigInt, timestamp: i64): void {
  const snapshotTimestamp = getSnapshotTimestamp(timestamp)
  const snapshotId = Bytes.fromHexString(staker.id).concat(Bytes.fromByteArray(Bytes.fromI64(snapshotTimestamp)))

  const earnedAssets = staker.totalAssets.minus(staker._prevSnapshotTotalAssets).minus(staker._periodFlowAssets)

  const stakerSnapshot = new StakerSnapshot(snapshotId)
  stakerSnapshot.timestamp = snapshotTimestamp
  stakerSnapshot.staker = staker.id
  stakerSnapshot.earnedAssets = earnedAssets
  stakerSnapshot.totalAssets = staker.totalAssets
  // the flows are assumed to be present for the whole period
  stakerSnapshot.apy = calculateApy(earnedAssets, staker.totalAssets.minus(earnedAssets), duration)
  stakerSnapshot.save()

  staker.totalEarnedAssets = staker.totalEarnedAssets.plus(earnedAssets)
  staker._periodFlowAssets = BigInt.zero()
  staker._prevSnapshotTotalAssets = staker.totalAssets
  staker.save()
}

function _getStakerApy(
  osToken: OsToken,
  aave: Aave | null,
  vault: Vault | null,
  osTokenConfig: OsTokenConfig | null,
  boostPosition: LeverageStrategyPosition | null,
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
  if (vault !== null && aave !== null && osTokenConfig !== null && boostPosition !== null) {
    totalEarnedAssets = totalEarnedAssets.plus(
      getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, boostPosition),
    )
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
