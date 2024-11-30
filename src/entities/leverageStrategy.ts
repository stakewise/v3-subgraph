import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  ExitRequest,
  LeverageStrategyPosition,
  LeverageStrategyPositionSnapshot,
  OsTokenExitRequest,
  Vault,
} from '../../generated/schema'
import { AaveLeverageStrategy } from '../../generated/Aave/AaveLeverageStrategy'
import { AAVE_LEVERAGE_STRATEGY, GENESIS_VAULT, WAD } from '../helpers/constants'
import { createOrLoadAllocator } from './allocator'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, createOrLoadOsToken } from './osToken'
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
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)

  // get borrow position state
  const proxy = Address.fromBytes(position.proxy)
  const borrowState = aaveLeverageStrategy.getBorrowState(proxy)
  const suppliedOsTokenShares = borrowState.getSuppliedOsTokenShares()
  const borrowedAssets = borrowState.getBorrowedAssets()

  // get vault position state
  const vaultAddress = Address.fromString(position.vault)
  const proxyAllocator = createOrLoadAllocator(Address.fromBytes(position.proxy), vaultAddress)
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
  if (borrowedAssets.ge(stakedAssets)) {
    const borrowLtv = aaveLeverageStrategy.getBorrowLtv()
    position.assets = BigInt.zero()
    position.osTokenShares = suppliedOsTokenShares
      .minus(mintedOsTokenShares)
      .minus(convertAssetsToOsTokenShares(osToken, borrowedAssets.minus(stakedAssets).div(borrowLtv)))
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
    const wad = BigInt.fromString(WAD)
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
