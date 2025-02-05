import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  Distributor,
  LeverageStrategyPosition,
  Network,
  OsToken,
  OsTokenHolder,
  OsTokenHolderSnapshot,
} from '../../generated/schema'
import { calculateApy, getAnnualReward } from '../helpers/utils'
import { convertOsTokenSharesToAssets, getOsTokenApy, osTokenId } from './osToken'
import { getBoostPositionAnnualReward, loadLeverageStrategyPosition } from './leverageStrategy'
import { loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { loadAave } from './aave'
import { loadAllocator } from './allocator'

export function loadOsTokenHolder(holderAddress: Address): OsTokenHolder | null {
  return OsTokenHolder.load(holderAddress.toHex())
}

export function createOrLoadOsTokenHolder(holderAddress: Address): OsTokenHolder {
  const id = holderAddress.toHex()
  let holder = OsTokenHolder.load(id)

  if (holder === null) {
    holder = new OsTokenHolder(id)
    holder.balance = BigInt.zero()
    holder.assets = BigInt.zero()
    holder.osToken = osTokenId
    holder.transfersCount = BigInt.zero()
    holder.apy = BigDecimal.zero()
    holder._periodEarnedAssets = BigInt.zero()
    holder.save()
  }

  return holder
}

export function getOsTokenHolderVault(network: Network, osTokenHolder: OsTokenHolder): Address | null {
  const osTokenHolderAddress = Address.fromString(osTokenHolder.id)

  // find OsToken holder vault
  let vaultAddress: Address
  let allocator: Allocator | null = null
  let boostPosition: LeverageStrategyPosition | null = null
  const osTokenVaultIds = network.osTokenVaultIds
  for (let i = 0; i < osTokenVaultIds.length; i++) {
    vaultAddress = Address.fromString(osTokenVaultIds[i])
    allocator = loadAllocator(osTokenHolderAddress, vaultAddress)
    if (allocator) {
      return vaultAddress
    }
    boostPosition = loadLeverageStrategyPosition(vaultAddress, osTokenHolderAddress)
    if (boostPosition) {
      return vaultAddress
    }
  }

  return null
}

export function getOsTokenHolderApy(
  network: Network,
  osToken: OsToken,
  distributor: Distributor,
  osTokenHolder: OsTokenHolder,
): BigDecimal {
  const osTokenApy = getOsTokenApy(osToken, false)

  let totalAssets = osTokenHolder.assets
  const vaultAddress = getOsTokenHolderVault(network, osTokenHolder)
  if (!vaultAddress) {
    return totalAssets.isZero() ? BigDecimal.zero() : osTokenApy
  }

  const vault = loadVault(vaultAddress)!
  let totalEarnedAssets = getAnnualReward(totalAssets, osTokenApy)

  // check balances of leverage strategy position
  const position = loadLeverageStrategyPosition(vaultAddress, Address.fromString(osTokenHolder.id))
  if (position) {
    const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
    const aave = loadAave()!
    totalAssets = totalAssets
      .plus(position.assets)
      .plus(position.exitingAssets)
      .plus(convertOsTokenSharesToAssets(osToken, position.osTokenShares.plus(position.exitingOsTokenShares)))
    totalEarnedAssets = totalEarnedAssets.plus(
      getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, position, distributor),
    )
  }

  if (totalAssets.isZero()) {
    return BigDecimal.zero()
  }

  const osTokenHolderApy = totalEarnedAssets.divDecimal(totalAssets.toBigDecimal()).times(BigDecimal.fromString('100'))
  if (osTokenApy.lt(vault.osTokenHolderMaxBoostApy) && osTokenHolderApy.gt(vault.osTokenHolderMaxBoostApy)) {
    log.warning(
      '[getOsTokenHolderApy] Calculated APY is higher than max boost APY: maxBoostApy={} osTokenHolderApy={} vault={} holder={}',
      [vault.osTokenHolderMaxBoostApy.toString(), osTokenHolderApy.toString(), vault.id, osTokenHolder.id],
    )
    return vault.osTokenHolderMaxBoostApy
  }
  return osTokenHolderApy
}

export function getOsTokenHolderTotalAssets(network: Network, osToken: OsToken, osTokenHolder: OsTokenHolder): BigInt {
  const osTokenHolderAddress = Address.fromString(osTokenHolder.id)
  let totalAssets = osTokenHolder.assets

  // find OsToken holder vault
  const vaultAddress = getOsTokenHolderVault(network, osTokenHolder)
  if (!vaultAddress) {
    return totalAssets
  }

  // add boost position assets
  const boostPosition = loadLeverageStrategyPosition(vaultAddress, osTokenHolderAddress)
  if (boostPosition) {
    totalAssets = totalAssets
      .plus(boostPosition.assets)
      .plus(boostPosition.exitingAssets)
      .plus(convertOsTokenSharesToAssets(osToken, boostPosition.osTokenShares.plus(boostPosition.exitingOsTokenShares)))
  }

  return totalAssets
}

export function updateOsTokenHolderAssets(osToken: OsToken, osTokenHolder: OsTokenHolder): void {
  const assetsBefore = osTokenHolder.assets
  osTokenHolder.assets = convertOsTokenSharesToAssets(osToken, osTokenHolder.balance)
  osTokenHolder._periodEarnedAssets = osTokenHolder._periodEarnedAssets.plus(osTokenHolder.assets.minus(assetsBefore))
  osTokenHolder.save()
}

export function snapshotOsTokenHolder(
  network: Network,
  osToken: OsToken,
  osTokenHolder: OsTokenHolder,
  earnedAssets: BigInt,
  duration: BigInt,
  timestamp: BigInt,
): void {
  const totalAssets = getOsTokenHolderTotalAssets(network, osToken, osTokenHolder)
  const snapshot = new OsTokenHolderSnapshot(timestamp.toString())
  snapshot.timestamp = timestamp.toI64()
  snapshot.osTokenHolder = osTokenHolder.id
  snapshot.earnedAssets = earnedAssets
  snapshot.totalAssets = totalAssets
  snapshot.apy = calculateApy(earnedAssets, totalAssets, duration)
  snapshot.save()
}
