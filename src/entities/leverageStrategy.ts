import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import {
  ExitRequest,
  LeverageStrategyPosition,
  LeverageStrategyPositionSnapshot,
  OsTokenExitRequest,
  Vault,
} from '../../generated/schema'
import { AaveLeverageStrategy } from '../../generated/Aave/AaveLeverageStrategy'
import { AAVE_LEVERAGE_STRATEGY, WAD } from '../helpers/constants'
import { createOrLoadAllocator } from './allocator'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, createOrLoadOsToken } from './osToken'
import { createOrLoadSnapshotEarnedAssets } from './snapshot'

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
  position: LeverageStrategyPosition,
  totalAssetsDiff: BigInt,
  earnedAssetsDiff: BigInt,
  timestamp: BigInt,
): void {
  const snapshotEarnedAssets = createOrLoadSnapshotEarnedAssets('leverageStrategyPosition', position.id, timestamp)
  snapshotEarnedAssets.earnedAssets = snapshotEarnedAssets.earnedAssets.plus(earnedAssetsDiff)
  snapshotEarnedAssets.save()

  let apy = BigDecimal.zero()
  const principalAssets = position.totalAssets.minus(snapshotEarnedAssets.earnedAssets)
  if (principalAssets.gt(BigInt.zero())) {
    apy = new BigDecimal(snapshotEarnedAssets.earnedAssets)
      .times(BigDecimal.fromString('365'))
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(principalAssets))
  }

  const positionSnapshot = new LeverageStrategyPositionSnapshot(timestamp.toString())
  positionSnapshot.timestamp = timestamp.toI64()
  positionSnapshot.position = position.id
  positionSnapshot.allocatorEarnedAssets = earnedAssetsDiff
  positionSnapshot.allocatorTotalEarnedAssets = position.totalEarnedAssets
  positionSnapshot.osTokenHolderEarnedAssets = totalAssetsDiff
  positionSnapshot.osTokenHolderTotalAssets = position.totalAssets
  positionSnapshot.apy = apy
  positionSnapshot.save()
}

export function updateLeverageStrategyPosition(position: LeverageStrategyPosition): void {
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)

  // get borrow position state
  const proxy = Address.fromBytes(position.proxy)
  const borrowState = aaveLeverageStrategy.getBorrowState(proxy)
  const suppliedOsTokenShares = borrowState.getSuppliedOsTokenShares()
  const borrowedAssets = borrowState.getBorrowedAssets()

  // get vault position state
  const vaultAddress = Address.fromString(position.vault)
  const proxyAllocator = createOrLoadAllocator(proxy, vaultAddress)
  let mintedOsTokenShares = proxyAllocator.mintedOsTokenShares
  let stakedAssets = proxyAllocator.assets

  if (position.exitRequest !== null) {
    const osTokenExitRequest = OsTokenExitRequest.load(position.exitRequest as string) as OsTokenExitRequest
    if (osTokenExitRequest.exitedAssets !== null) {
      stakedAssets = stakedAssets.plus(osTokenExitRequest.exitedAssets as BigInt)
    } else {
      // exit request and osToken exit request have the same id format
      const exitRequest = ExitRequest.load(position.exitRequest as string) as ExitRequest
      stakedAssets = stakedAssets.plus(exitRequest.totalAssets)
    }
    mintedOsTokenShares = mintedOsTokenShares.plus(osTokenExitRequest.osTokenShares)
  }

  const osToken = createOrLoadOsToken()
  const wad = BigInt.fromString(WAD)
  if (borrowedAssets.ge(stakedAssets)) {
    const borrowLtv = aaveLeverageStrategy.getBorrowLtv()
    position.assets = BigInt.zero()
    position.osTokenShares = suppliedOsTokenShares
      .minus(mintedOsTokenShares)
      .minus(convertAssetsToOsTokenShares(osToken, borrowedAssets.minus(stakedAssets).times(wad).div(borrowLtv)))
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
}

export function updateLeverageStrategyPositions(vault: Vault, updateTimestamp: BigInt): void {
  const osToken = createOrLoadOsToken()

  let position: LeverageStrategyPosition
  const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
  for (let i = 0; i < leveragePositions.length; i++) {
    position = leveragePositions[i]
    const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
    const assetsBefore = position.assets.plus(position.exitingAssets)
    const totalAssetsBefore = position.totalAssets

    updateLeverageStrategyPosition(position)

    const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
    const assetsAfter = position.assets.plus(position.exitingAssets)
    const totalAssetsAfter = position.totalAssets

    const assetsDiff = assetsAfter.minus(assetsBefore)
    const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore)

    const earnedAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
    const totalAssetsDiff = totalAssetsAfter.minus(totalAssetsBefore)

    position.totalEarnedAssets = position.totalEarnedAssets.plus(earnedAssetsDiff)
    position.save()

    snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, updateTimestamp)
  }
}
