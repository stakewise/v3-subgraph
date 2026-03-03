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

function clampToZero(value: BigInt): BigInt {
  return value.lt(BigInt.zero()) ? BigInt.zero() : value
}

export function updateLeveragePosition(aave: Aave, osToken: OsToken, position: LeverageStrategyPosition): void {
  if (aave.leverageMaxBorrowLtvPercent.isZero()) {
    assert(false, 'Leverage max borrow LTV percent is zero')
  }

  const proxy = Address.fromBytes(position.proxy)
  const borrowState = loadAavePosition(proxy)!
  const borrowedAssets = borrowState.borrowedAssets
  const suppliedOsTokenShares = borrowState.suppliedOsTokenShares

  const vaultAddress = Address.fromString(position.vault)
  const proxyAllocator = loadAllocator(proxy, vaultAddress)!
  let mintedOsTokenShares = proxyAllocator.mintedOsTokenShares
  let stakedAssets = proxyAllocator.assets

  // resolve exit request data once (used in both position and exiting calculations)
  let exitQueueAssets = BigInt.zero()
  let escrowedOsTokenShares = BigInt.zero()
  if (position.exitRequest) {
    const osTokenExitRequest = OsTokenExitRequest.load(position.exitRequest!)!
    escrowedOsTokenShares = osTokenExitRequest.osTokenShares
    exitQueueAssets =
      osTokenExitRequest.exitedAssets !== null
        ? osTokenExitRequest.exitedAssets!
        : ExitRequest.load(position.exitRequest!)!.totalAssets
    stakedAssets = stakedAssets.plus(exitQueueAssets)
    mintedOsTokenShares = mintedOsTokenShares.plus(escrowedOsTokenShares)
  }

  const wad = BigInt.fromString(WAD)

  if (borrowedAssets.ge(stakedAssets)) {
    const leftOsTokenAssets = borrowedAssets.minus(stakedAssets).times(wad).div(aave.leverageMaxBorrowLtvPercent)
    position.assets = BigInt.zero()
    position.osTokenShares = clampToZero(
      suppliedOsTokenShares.minus(mintedOsTokenShares).minus(convertAssetsToOsTokenShares(osToken, leftOsTokenAssets)),
    )
  } else {
    position.osTokenShares = clampToZero(suppliedOsTokenShares.minus(mintedOsTokenShares))
    position.assets = clampToZero(stakedAssets.minus(borrowedAssets))
  }

  const suppliedOsTokenAssets = convertOsTokenSharesToAssets(osToken, suppliedOsTokenShares)
  position.borrowLtv = suppliedOsTokenAssets.gt(BigInt.zero())
    ? borrowedAssets.divDecimal(suppliedOsTokenAssets.toBigDecimal())
    : BigDecimal.zero()

  if (position.exitingPercent.gt(BigInt.zero())) {
    const repayAssets = borrowedAssets.lt(exitQueueAssets) ? borrowedAssets : exitQueueAssets
    const remainingDebt = borrowedAssets.minus(repayAssets)

    position.exitingAssets = exitQueueAssets.minus(repayAssets)

    let reservedSupply = BigInt.zero()
    if (remainingDebt.gt(BigInt.zero())) {
      reservedSupply = convertAssetsToOsTokenShares(
        osToken,
        remainingDebt.times(wad).div(aave.leverageMaxBorrowLtvPercent),
      )
    }

    position.exitingOsTokenShares = clampToZero(
      suppliedOsTokenShares.minus(reservedSupply).minus(escrowedOsTokenShares),
    )
    position.osTokenShares = clampToZero(position.osTokenShares.minus(position.exitingOsTokenShares))
    position.assets = clampToZero(position.assets.minus(position.exitingAssets))
  } else {
    position.exitingOsTokenShares = BigInt.zero()
    position.exitingAssets = BigInt.zero()
  }

  position.save()
}
