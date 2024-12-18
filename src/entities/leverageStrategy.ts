import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import {
  Aave,
  Distributor,
  ExitRequest,
  LeverageStrategyPosition,
  Network,
  OsToken,
  OsTokenConfig,
  OsTokenExitRequest,
  PeriodicDistribution,
  Vault,
} from '../../generated/schema'
import { AaveLeverageStrategy } from '../../generated/PeriodicTasks/AaveLeverageStrategy'
import { AAVE_LEVERAGE_STRATEGY, WAD } from '../helpers/constants'
import { loadAllocator, snapshotAllocator } from './allocator'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, getOsTokenApy } from './osToken'
import { getAnnualReward } from '../helpers/utils'
import { getVaultApy, getVaultOsTokenMintApy } from './vault'
import {
  createOrLoadAavePosition,
  getAaveBorrowApy,
  getAaveSupplyApy,
  loadAavePosition,
  updateAavePosition,
} from './aave'
import { convertStringToDistributionType, DistributionType, getPeriodicDistributionApy } from './merkleDistributor'
import { loadOsTokenHolder, snapshotOsTokenHolder } from './osTokenHolder'

export function loadLeverageStrategyPosition(vault: Address, user: Address): LeverageStrategyPosition | null {
  const leverageStrategyPositionId = `${vault.toHex()}-${user.toHex()}`
  return LeverageStrategyPosition.load(leverageStrategyPositionId)
}

export function createOrLoadLeverageStrategyPosition(vault: Address, user: Address): LeverageStrategyPosition {
  const vaultAddressHex = vault.toHex()
  const leverageStrategyPositionId = `${vaultAddressHex}-${user.toHex()}`

  let leverageStrategyPosition = LeverageStrategyPosition.load(leverageStrategyPositionId)

  if (leverageStrategyPosition === null) {
    const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)
    leverageStrategyPosition = new LeverageStrategyPosition(leverageStrategyPositionId)
    leverageStrategyPosition.proxy = aaveLeverageStrategy.getStrategyProxy(vault, user)
    leverageStrategyPosition.user = user
    leverageStrategyPosition.vault = vaultAddressHex
    leverageStrategyPosition.osTokenShares = BigInt.zero()
    leverageStrategyPosition.assets = BigInt.zero()
    leverageStrategyPosition.totalEarnedAssets = BigInt.zero()
    leverageStrategyPosition.totalAssets = BigInt.zero()
    leverageStrategyPosition.borrowLtv = BigDecimal.zero()
    leverageStrategyPosition.exitingPercent = BigInt.zero()
    leverageStrategyPosition.exitingOsTokenShares = BigInt.zero()
    leverageStrategyPosition.exitingAssets = BigInt.zero()
    leverageStrategyPosition.save()
  }

  return leverageStrategyPosition
}

export function snapshotLeverageStrategyPosition(
  network: Network,
  osToken: OsToken,
  distributor: Distributor,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  position: LeverageStrategyPosition,
  totalAssetsDiff: BigInt,
  earnedAssetsDiff: BigInt,
  timestamp: BigInt,
): void {
  let userAddress = Address.fromBytes(position.user)
  const allocator = loadAllocator(userAddress, Address.fromString(vault.id))
  if (allocator) {
    snapshotAllocator(osToken, osTokenConfig, vault, distributor, allocator, earnedAssetsDiff, timestamp)
  }

  const osTokenHolder = loadOsTokenHolder(userAddress)!
  snapshotOsTokenHolder(network, osToken, distributor, osTokenHolder, totalAssetsDiff, timestamp)
}

export function updateLeverageStrategyPosition(osToken: OsToken, position: LeverageStrategyPosition): void {
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)

  // get and update borrow position state
  const proxy = Address.fromBytes(position.proxy)
  const borrowState = createOrLoadAavePosition(proxy)
  updateAavePosition(borrowState)
  const borrowedAssets = borrowState.borrowedAssets
  const suppliedOsTokenShares = borrowState.suppliedOsTokenShares

  // get vault position state
  const vaultAddress = Address.fromString(position.vault)
  const proxyAllocator = loadAllocator(proxy, vaultAddress)!
  let mintedOsTokenShares = proxyAllocator.mintedOsTokenShares
  let stakedAssets = proxyAllocator.assets

  if (position.exitRequest) {
    const osTokenExitRequest = OsTokenExitRequest.load(position.exitRequest!)!
    if (osTokenExitRequest.exitedAssets) {
      stakedAssets = stakedAssets.plus(osTokenExitRequest.exitedAssets!)
    } else {
      // exit request and osToken exit request have the same id format
      const exitRequest = ExitRequest.load(position.exitRequest!)!
      stakedAssets = stakedAssets.plus(exitRequest.totalAssets)
    }
    mintedOsTokenShares = mintedOsTokenShares.plus(osTokenExitRequest.osTokenShares)
  }

  const wad = BigInt.fromString(WAD)
  if (borrowedAssets.ge(stakedAssets)) {
    const borrowLtv = aaveLeverageStrategy.getBorrowLtv()
    const leftOsTokenAssets = borrowedAssets.minus(stakedAssets).times(wad).div(borrowLtv)
    position.assets = BigInt.zero()
    position.osTokenShares = suppliedOsTokenShares
      .minus(mintedOsTokenShares)
      .minus(convertAssetsToOsTokenShares(osToken, leftOsTokenAssets))
    if (position.osTokenShares.lt(BigInt.zero())) {
      position.osTokenShares = BigInt.zero()
    }
  } else {
    position.osTokenShares = suppliedOsTokenShares.minus(mintedOsTokenShares)
    position.assets = stakedAssets.minus(borrowedAssets)
    if (position.assets.lt(BigInt.zero())) {
      position.assets = BigInt.zero()
    }
  }

  if (suppliedOsTokenShares.gt(BigInt.zero())) {
    position.borrowLtv = borrowedAssets.divDecimal(
      new BigDecimal(convertOsTokenSharesToAssets(osToken, suppliedOsTokenShares)),
    )
  } else {
    position.borrowLtv = BigDecimal.zero()
  }

  position.totalAssets = convertOsTokenSharesToAssets(osToken, position.osTokenShares).plus(position.assets)
  if (position.exitingPercent.gt(BigInt.zero())) {
    position.exitingOsTokenShares = position.osTokenShares.times(position.exitingPercent).div(wad)
    position.osTokenShares = position.osTokenShares.minus(position.exitingOsTokenShares)
    position.exitingAssets = position.assets.times(position.exitingPercent).div(wad)
    position.assets = position.assets.minus(position.exitingAssets)
  } else {
    position.exitingOsTokenShares = BigInt.zero()
    position.exitingAssets = BigInt.zero()
  }
  position.save()
}

export function updateLeverageStrategyPositions(
  network: Network,
  osToken: OsToken,
  distributor: Distributor,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  timestamp: BigInt,
): void {
  let position: LeverageStrategyPosition
  const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
  for (let i = 0; i < leveragePositions.length; i++) {
    position = leveragePositions[i]
    const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
    const assetsBefore = position.assets.plus(position.exitingAssets)
    const totalAssetsBefore = position.totalAssets

    updateLeverageStrategyPosition(osToken, position)

    const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
    const assetsAfter = position.assets.plus(position.exitingAssets)
    const totalAssetsAfter = position.totalAssets

    const assetsDiff = assetsAfter.minus(assetsBefore)
    const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore)

    const earnedAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
    const totalAssetsDiff = totalAssetsAfter.minus(totalAssetsBefore)

    snapshotLeverageStrategyPosition(
      network,
      osToken,
      distributor,
      vault,
      osTokenConfig,
      position,
      totalAssetsDiff,
      earnedAssetsDiff,
      timestamp,
    )
  }
}

export function getBoostPositionAnnualReward(
  osToken: OsToken,
  aave: Aave,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  strategyPosition: LeverageStrategyPosition,
  distributor: Distributor,
  useDayApy: boolean,
): BigInt {
  const vaultAddress = Address.fromString(strategyPosition.vault)
  const proxyAddress = Address.fromBytes(strategyPosition.proxy)

  const vaultPosition = loadAllocator(proxyAddress, vaultAddress)!
  const aavePosition = loadAavePosition(proxyAddress)!

  const vaultApy = getVaultApy(vault, useDayApy)
  const osTokenApy = getOsTokenApy(osToken, useDayApy)
  const borrowApy = getAaveBorrowApy(aave, useDayApy)
  const supplyApy = getAaveSupplyApy(aave, osToken, useDayApy)

  let totalDepositedAssets = vaultPosition.assets
  let totalMintedOsTokenShares = vaultPosition.mintedOsTokenShares
  if (strategyPosition.exitRequest !== null) {
    const osTokenExitRequest = OsTokenExitRequest.load(strategyPosition.exitRequest!)!
    if (osTokenExitRequest.exitedAssets === null) {
      const exitRequest = ExitRequest.load(strategyPosition.exitRequest!)!
      const notExitedAssets = exitRequest.totalAssets.minus(exitRequest.exitedAssets)
      totalDepositedAssets = totalDepositedAssets.plus(notExitedAssets)
    }
    totalMintedOsTokenShares = totalMintedOsTokenShares.plus(osTokenExitRequest.osTokenShares)
  }

  const totalSuppliedOsTokenShares = aavePosition.suppliedOsTokenShares
  const totalBorrowedAssets = aavePosition.borrowedAssets

  // deposited assets earn vault APY
  let totalEarnedAssets = getAnnualReward(totalDepositedAssets, vaultApy)

  // supplied osToken shares earn osToken APY
  const totalSuppliedOsTokenAssets = convertOsTokenSharesToAssets(osToken, totalSuppliedOsTokenShares)
  totalEarnedAssets = totalEarnedAssets.plus(getAnnualReward(totalSuppliedOsTokenAssets, osTokenApy))

  // supplied osToken shares earn supply APY
  const totalEarnedOsTokenShares = getAnnualReward(totalSuppliedOsTokenShares, supplyApy)
  totalEarnedAssets = totalEarnedAssets.plus(convertOsTokenSharesToAssets(osToken, totalEarnedOsTokenShares))

  // minted osToken shares lose mint APY
  const osTokenMintApy = getVaultOsTokenMintApy(osToken, osTokenConfig, useDayApy)
  const totalMintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, totalMintedOsTokenShares)
  totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(totalMintedOsTokenAssets, osTokenMintApy))

  // borrowed assets lose borrow APY
  totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(totalBorrowedAssets, borrowApy))

  if (totalSuppliedOsTokenAssets.le(BigInt.zero())) {
    return totalEarnedAssets
  }

  // all the supplied OsToken assets earn the additional incentives
  const activeDistributionIds = distributor.activeDistributionIds
  let distribution: PeriodicDistribution
  let distributionApy: BigDecimal
  for (let i = 0; i < activeDistributionIds.length; i++) {
    distribution = PeriodicDistribution.load(activeDistributionIds[i])!
    if (convertStringToDistributionType(distribution.distributionType) !== DistributionType.LEVERAGE_STRATEGY) {
      continue
    }

    // get the distribution APY
    distributionApy = getPeriodicDistributionApy(distribution, osToken, useDayApy)
    if (distributionApy.equals(BigDecimal.zero())) {
      continue
    }
    totalEarnedAssets = totalEarnedAssets.plus(getAnnualReward(totalSuppliedOsTokenAssets, distributionApy))
  }

  return totalEarnedAssets
}
