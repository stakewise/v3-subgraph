import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, LeverageStrategyPosition, LeverageStrategyPositionSnapshot, Vault } from '../../generated/schema'
import { AavePool } from '../../generated/AaveLeverageStrategy/AavePool'
import { AaveOracle } from '../../generated/AaveLeverageStrategy/AaveOracle'
import { StrategiesRegistry } from '../../generated/AaveLeverageStrategy/StrategiesRegistry'
import { AaveLeverageStrategy } from '../../generated/Aave/AaveLeverageStrategy'
import { OsTokenVaultEscrow } from '../../generated/AaveLeverageStrategy/OsTokenVaultEscrow'
import {
  AAVE_LEVERAGE_STRATEGY,
  AAVE_ORACLE,
  AAVE_POOL,
  ASSET_TOKEN,
  GENESIS_VAULT,
  OS_TOKEN,
  OS_TOKEN_VAULT_ESCROW,
  STRATEGIES_REGISTRY,
  WAD,
} from '../helpers/constants'
import { createOrLoadAllocator } from './allocator'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, createOrLoadOsToken } from './osToken'
import { createOrLoadOsTokenConfig } from './osTokenConfig'
import { createOrLoadV2Pool } from './v2pool'

export function createOrLoadLeverageStrategyPosition(vault: Address, user: Address): LeverageStrategyPosition {
  const vaultAddressHex = vault.toHex()
  const leverageStrategyPositionId = `${vaultAddressHex}-${user.toHex()}`

  let leverageStrategyPosition = LeverageStrategyPosition.load(leverageStrategyPositionId)

  if (leverageStrategyPosition === null) {
    leverageStrategyPosition = new LeverageStrategyPosition(leverageStrategyPositionId)
    leverageStrategyPosition.proxy = Address.zero()
    leverageStrategyPosition.user = user
    leverageStrategyPosition.vault = vaultAddressHex
    leverageStrategyPosition.osTokenShares = BigInt.zero()
    leverageStrategyPosition.assets = BigInt.zero()
    leverageStrategyPosition.totalEarnedBoostAssets = BigInt.zero()
    leverageStrategyPosition.exitingPercent = BigInt.zero()
    leverageStrategyPosition.exitingOsTokenShares = BigInt.zero()
    leverageStrategyPosition.exitingAssets = BigInt.zero()
    leverageStrategyPosition.save()
  }

  return leverageStrategyPosition
}

export function snapshotLeverageStrategyPosition(
  position: LeverageStrategyPosition,
  earnedAssets: BigInt,
  totalAssets: BigInt,
  earnedBoostAssets: BigInt,
  totalEarnedBoostAssets: BigInt,
  timestamp: BigInt,
): void {
  const positionSnapshot = new LeverageStrategyPositionSnapshot(timestamp.toString())
  positionSnapshot.timestamp = timestamp.toI64()
  positionSnapshot.position = position.id
  positionSnapshot.earnedAssets = earnedAssets
  positionSnapshot.totalAssets = totalAssets
  positionSnapshot.earnedBoostAssets = earnedBoostAssets
  positionSnapshot.totalEarnedBoostAssets = totalEarnedBoostAssets
  positionSnapshot.save()
}

export function updateLeverageStrategyPosition(position: LeverageStrategyPosition): void {
  const aavePoolContract = AavePool.bind(Address.fromString(AAVE_POOL))
  const aaveOracleContract = AaveOracle.bind(Address.fromString(AAVE_ORACLE))
  const wad = BigInt.fromString(WAD)

  // get prices for osToken and assetToken
  const response = aaveOracleContract.getAssetsPrices([OS_TOKEN, Address.fromString(ASSET_TOKEN)])
  const osTokenPrice = response[0]
  const assetTokenPrice = response[1]

  // get user Aave position state
  const userData = aavePoolContract.getUserAccountData(Address.fromBytes(position.proxy))
  let suppliedOsTokenShares = userData.getTotalCollateralBase().times(wad).div(osTokenPrice)
  let borrowedAssets = userData.getTotalDebtBase().times(wad).div(assetTokenPrice)

  // get user vault position state
  const vaultAddress = Address.fromString(position.vault)
  const proxyAllocator = createOrLoadAllocator(Address.fromBytes(position.proxy), vaultAddress)
  let mintedOsTokenShares = proxyAllocator.mintedOsTokenShares
  let stakedAssets = proxyAllocator.assets

  if (position.exitRequest !== null) {
    const exitRequest = ExitRequest.load(position.exitRequest as string) as ExitRequest
    const osTokenVaultEscrow = OsTokenVaultEscrow.bind(OS_TOKEN_VAULT_ESCROW)
    const response = osTokenVaultEscrow.getPosition(vaultAddress, exitRequest.positionTicket)
    stakedAssets = stakedAssets.plus(exitRequest.totalAssets)
    mintedOsTokenShares = mintedOsTokenShares.plus(response.getValue2())
  }

  const aaveLtv = getAaveLeverageLtv()
  const osToken = createOrLoadOsToken()
  if (borrowedAssets.ge(stakedAssets)) {
    position.assets = BigInt.zero()
    position.osTokenShares = suppliedOsTokenShares
      .minus(mintedOsTokenShares)
      .minus(convertAssetsToOsTokenShares(osToken, borrowedAssets.minus(stakedAssets).div(aaveLtv)))
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

  if (position.exitingPercent.gt(BigInt.zero())) {
    position.exitingOsTokenShares = position.osTokenShares.times(position.exitingPercent).div(wad)
    position.osTokenShares = position.osTokenShares.minus(position.exitingOsTokenShares)
    position.exitingAssets = position.assets.times(position.exitingPercent).div(wad)
    position.assets = position.assets.minus(position.exitingAssets)
  } else {
    position.exitingOsTokenShares = BigInt.zero()
    position.exitingAssets = BigInt.zero()
  }
}

export function updateLeverageStrategyPositions(vault: Vault, updateTimestamp: BigInt): void {
  if (Address.fromString(vault.id).equals(GENESIS_VAULT)) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      // wait for the migration
      return
    }
  }
  const osToken = createOrLoadOsToken()

  let position: LeverageStrategyPosition
  const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
  for (let i = 0; i < leveragePositions.length; i++) {
    position = leveragePositions[i]
    const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
    const assetsBefore = position.assets.plus(position.exitingAssets)

    updateLeverageStrategyPosition(position)

    const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
    const osTokenAssetsAfter = convertOsTokenSharesToAssets(osToken, osTokenSharesAfter)
    const assetsAfter = position.assets.plus(position.exitingAssets)

    const assetsDiff = assetsAfter.minus(assetsBefore)
    const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore)

    const earnedAssets = assetsAfter
      .plus(osTokenAssetsAfter)
      .minus(convertOsTokenSharesToAssets(osToken, osTokenSharesBefore))
      .minus(assetsBefore)
    const earnedBoostAssets = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
    position.totalEarnedBoostAssets = position.totalEarnedBoostAssets.plus(earnedBoostAssets)
    position.save()

    snapshotLeverageStrategyPosition(
      position,
      earnedAssets,
      osTokenAssetsAfter.plus(assetsAfter),
      earnedBoostAssets,
      position.totalEarnedBoostAssets,
      updateTimestamp,
    )
  }
}

export function getAaveLeverageLtv(): BigInt {
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)
  const strategiesRegistry = StrategiesRegistry.bind(Address.fromString(STRATEGIES_REGISTRY))
  const aavePoolContract = AavePool.bind(Address.fromString(AAVE_POOL))
  const wad = BigInt.fromString(WAD)

  let aaveLeverageLtv = BigInt.fromI32(0)
  if (aaveLeverageStrategy._address.notEqual(Address.zero()) && strategiesRegistry._address.notEqual(Address.zero())) {
    const response = strategiesRegistry.getStrategyConfig(aaveLeverageStrategy.strategyId(), 'maxBorrowLtvPercent')
    aaveLeverageLtv = ethereum.decode('uint256', response)!.toBigInt()
  }
  const aaveLtv = BigInt.fromI32(aavePoolContract.getEModeCategoryCollateralConfig(1).ltv)
  if (aaveLeverageLtv.isZero() || aaveLtv.lt(aaveLeverageLtv)) {
    aaveLeverageLtv = aaveLtv.times(wad).div(BigInt.fromI32(10000))
  }
  return aaveLeverageLtv
}

export function getVaultLeverageLtv(vault: Vault): BigInt {
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)
  const strategiesRegistry = StrategiesRegistry.bind(Address.fromString(STRATEGIES_REGISTRY))
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  let vaultLtv = BigInt.zero()
  if (aaveLeverageStrategy._address.notEqual(Address.zero()) && strategiesRegistry._address.notEqual(Address.zero())) {
    const response = strategiesRegistry.getStrategyConfig(aaveLeverageStrategy.strategyId(), 'maxVaultLtvPercent')
    vaultLtv = ethereum.decode('uint256', response)!.toBigInt()
  }
  if (vaultLtv.isZero() || osTokenConfig.ltvPercent.lt(vaultLtv)) {
    vaultLtv = osTokenConfig.ltvPercent
  }
  return vaultLtv
}
