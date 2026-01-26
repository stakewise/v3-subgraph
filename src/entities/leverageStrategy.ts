import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { Aave, ExitRequest, LeverageStrategyPosition, OsToken, OsTokenExitRequest } from '../../generated/schema'
import { AaveLeverageStrategy } from '../../generated/AaveLeverageStrategyV1/AaveLeverageStrategy'
import { AAVE_LEVERAGE_STRATEGY_V2, WAD } from '../helpers/constants'
import { loadAllocator } from './allocator'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets } from './osToken'
import { loadAavePosition } from './aave'

export function loadLeverageStrategyPosition(vault: Address, user: Address): LeverageStrategyPosition | null {
  const leverageStrategyPositionId = `${vault.toHex()}-${user.toHex()}`
  return LeverageStrategyPosition.load(leverageStrategyPositionId)
}

export function createOrLoadLeverageStrategyPosition(
  vault: Address,
  user: Address,
  leverageStrategy: Address,
): LeverageStrategyPosition {
  const vaultAddressHex = vault.toHex()
  const leverageStrategyPositionId = `${vaultAddressHex}-${user.toHex()}`

  let leverageStrategyPosition = LeverageStrategyPosition.load(leverageStrategyPositionId)

  if (leverageStrategyPosition === null) {
    const aaveLeverageStrategy = AaveLeverageStrategy.bind(leverageStrategy)
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
    leverageStrategyPosition.version = leverageStrategy.equals(AAVE_LEVERAGE_STRATEGY_V2)
      ? BigInt.fromI32(2)
      : BigInt.fromI32(1)
    leverageStrategyPosition.save()
  }

  return leverageStrategyPosition
}

export function updateLeveragePosition(aave: Aave, osToken: OsToken, position: LeverageStrategyPosition): void {
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
