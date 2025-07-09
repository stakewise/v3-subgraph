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
    holder.totalEarnedAssets = BigInt.zero()
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

export function snapshotOsTokenHolder(
  network: Network,
  osToken: OsToken,
  osTokenHolder: OsTokenHolder,
  duration: BigInt,
  timestamp: BigInt,
): OsTokenHolderSnapshot {
  const totalAssets = _getOsTokenHolderTotalAssets(network, osToken, osTokenHolder)
  const snapshot = new OsTokenHolderSnapshot(1)
  snapshot.timestamp = timestamp.toI64()
  snapshot.osTokenHolder = osTokenHolder.id
  snapshot.earnedAssets = osTokenHolder._periodEarnedAssets
  snapshot.totalAssets = totalAssets
  snapshot.apy = calculateApy(snapshot.earnedAssets, totalAssets, duration)
  snapshot.save()

  return snapshot
}

function _getOsTokenHolderTotalAssets(network: Network, osToken: OsToken, osTokenHolder: OsTokenHolder): BigInt {
  const osTokenHolderAddress = Address.fromString(osTokenHolder.id)
  let totalAssets = osTokenHolder.assets

  // find OsToken holder vault
  let boostPosition: LeverageStrategyPosition | null = null

  let allocator: Allocator | null = null
  let osTokenVaultAddress: Address
  const osTokenVaultIds = network.osTokenVaultIds
  for (let i = 0; i < osTokenVaultIds.length; i++) {
    osTokenVaultAddress = Address.fromString(osTokenVaultIds[i])
    allocator = loadAllocator(osTokenHolderAddress, osTokenVaultAddress)
    boostPosition = loadLeverageStrategyPosition(osTokenVaultAddress, osTokenHolderAddress)
    if (allocator || boostPosition) {
      break
    }
  }

  // add boost position assets
  if (boostPosition) {
    return totalAssets
      .plus(boostPosition.assets)
      .plus(boostPosition.exitingAssets)
      .plus(convertOsTokenSharesToAssets(osToken, boostPosition.osTokenShares.plus(boostPosition.exitingOsTokenShares)))
  }

  return totalAssets
}
