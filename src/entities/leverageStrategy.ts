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
  Vault,
} from '../../generated/schema'
import { AaveLeverageStrategy } from '../../generated/PeriodicTasks/AaveLeverageStrategy'
import { AAVE_LEVERAGE_STRATEGY, WAD } from '../helpers/constants'
import { createOrLoadAllocator, loadAllocator } from './allocator'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, getOsTokenApy } from './osToken'
import { getAnnualReward, getCompoundedApy } from '../helpers/utils'
import { getVaultApy, getVaultOsTokenMintApy } from './vault'
import { loadAavePosition } from './aave'
import {
  convertStringToDistributionType,
  DistributionType,
  getPeriodicDistributionApy,
  loadPeriodicDistribution,
} from './merkleDistributor'
import { getOsTokenHolderVault, loadOsTokenHolder } from './osTokenHolder'

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
    leverageStrategyPosition.borrowLtv = BigDecimal.zero()
    leverageStrategyPosition.exitingPercent = BigInt.zero()
    leverageStrategyPosition.exitingOsTokenShares = BigInt.zero()
    leverageStrategyPosition.exitingAssets = BigInt.zero()
    leverageStrategyPosition._totalAssets = BigInt.zero()
    leverageStrategyPosition._totalOsTokenShares = BigInt.zero()
    leverageStrategyPosition.save()
  }

  return leverageStrategyPosition
}

export function updateLeverageStrategyPosition(aave: Aave, osToken: OsToken, position: LeverageStrategyPosition): void {
  if (aave.leverageMaxBorrowLtvPercent.isZero()) {
    assert(false, 'Leverage max borrow LTV percent is zero')
  }
  // get and update borrow position state
  const proxy = Address.fromBytes(position.proxy)
  let borrowState = loadAavePosition(proxy)!
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
    const leftOsTokenAssets = borrowedAssets.minus(stakedAssets).times(wad).div(aave.leverageMaxBorrowLtvPercent)
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

  position._totalOsTokenShares = position.osTokenShares.plus(convertAssetsToOsTokenShares(osToken, position.assets))
  position._totalAssets = convertOsTokenSharesToAssets(osToken, position._totalOsTokenShares)
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

export function updateLeverageStrategyPositions(network: Network, aave: Aave, osToken: OsToken, vault: Vault): void {
  const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
  const vaultAddr = Address.fromString(vault.id)

  for (let i = 0; i < leveragePositions.length; i++) {
    const position = leveragePositions[i]

    const totalOsTokenSharesBefore = position._totalOsTokenShares
    const totalAssetsBefore = position._totalAssets
    updateLeverageStrategyPosition(aave, osToken, position)
    const totalOsTokenSharesAfter = position._totalOsTokenShares

    const earnedOsTokenShares = totalOsTokenSharesAfter.minus(totalOsTokenSharesBefore)
    const earnedAssets = convertOsTokenSharesToAssets(osToken, earnedOsTokenShares)

    // check whether we can add osToken rewards
    const userAddress = Address.fromBytes(position.user)
    const allocator = createOrLoadAllocator(userAddress, vaultAddr)
    const extraOsTokenShares = totalOsTokenSharesAfter.minus(allocator.mintedOsTokenShares).minus(earnedOsTokenShares)
    if (extraOsTokenShares.gt(BigInt.zero()) && totalOsTokenSharesBefore.gt(BigInt.zero())) {
      const extraOsTokenAssetsBefore = extraOsTokenShares.times(totalAssetsBefore).div(totalOsTokenSharesBefore)
      const extraOsTokenAssetsAfter = convertOsTokenSharesToAssets(osToken, extraOsTokenShares)
      allocator._periodEarnedAssets = allocator._periodEarnedAssets
        .plus(extraOsTokenAssetsAfter)
        .minus(extraOsTokenAssetsBefore)
    }
    allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(earnedAssets)
    allocator.save()

    const osTokenHolder = loadOsTokenHolder(userAddress)!
    const osTokenHolderVault = getOsTokenHolderVault(network, osTokenHolder)
    if (osTokenHolderVault && osTokenHolderVault.equals(vaultAddr)) {
      osTokenHolder._periodEarnedAssets = osTokenHolder._periodEarnedAssets
        .plus(position._totalAssets)
        .minus(totalAssetsBefore)
      osTokenHolder.save()
    }
  }
}

export function getBoostPositionAnnualReward(
  osToken: OsToken,
  aave: Aave,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  strategyPosition: LeverageStrategyPosition,
  distributor: Distributor,
): BigInt {
  const vaultAddress = Address.fromString(strategyPosition.vault)
  const proxyAddress = Address.fromBytes(strategyPosition.proxy)

  const vaultPosition = loadAllocator(proxyAddress, vaultAddress)!
  const aavePosition = loadAavePosition(proxyAddress)!

  const vaultApy = getVaultApy(vault, distributor, osToken, false)
  const osTokenApy = getOsTokenApy(osToken, false)
  const borrowApy = aave.borrowApy
  // earned osToken shares earn extra staking rewards, apply compounding
  const supplyApy = getCompoundedApy(aave.supplyApy, osTokenApy)

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
  const totalMintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, totalMintedOsTokenShares)

  const totalSuppliedOsTokenShares = aavePosition.suppliedOsTokenShares
  const totalBorrowedAssets = aavePosition.borrowedAssets

  // deposited assets earn vault APY
  let totalEarnedAssets = getAnnualReward(totalDepositedAssets, vaultApy)

  // supplied osToken shares that are not minted earn osToken APY
  const totalSuppliedOsTokenAssets = convertOsTokenSharesToAssets(osToken, totalSuppliedOsTokenShares)
  if (totalSuppliedOsTokenAssets.gt(totalMintedOsTokenAssets)) {
    totalEarnedAssets = totalEarnedAssets.plus(
      getAnnualReward(totalSuppliedOsTokenAssets.minus(totalMintedOsTokenAssets), osTokenApy),
    )
  }

  // supplied osToken shares earn supply APY
  const totalEarnedOsTokenShares = getAnnualReward(totalSuppliedOsTokenShares, supplyApy)
  totalEarnedAssets = totalEarnedAssets.plus(convertOsTokenSharesToAssets(osToken, totalEarnedOsTokenShares))

  // minted osToken shares lose mint APY
  const osTokenMintApy = getVaultOsTokenMintApy(osToken, osTokenConfig)
  totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(totalMintedOsTokenAssets, osTokenMintApy))

  // borrowed assets lose borrow APY
  totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(totalBorrowedAssets, borrowApy))

  if (totalSuppliedOsTokenAssets.le(BigInt.zero())) {
    return totalEarnedAssets
  }

  // all the supplied OsToken assets earn the additional incentives
  const activeDistributionIds = distributor.activeDistributionIds
  for (let i = 0; i < activeDistributionIds.length; i++) {
    const distribution = loadPeriodicDistribution(activeDistributionIds[i])!
    if (convertStringToDistributionType(distribution.distributionType) !== DistributionType.LEVERAGE_STRATEGY) {
      continue
    }

    // get the distribution APY
    const distributionApy = getPeriodicDistributionApy(distribution, osToken, false)
    if (distributionApy.le(BigDecimal.zero())) {
      continue
    }
    totalEarnedAssets = totalEarnedAssets.plus(getAnnualReward(totalSuppliedOsTokenAssets, distributionApy))
  }

  return totalEarnedAssets
}
