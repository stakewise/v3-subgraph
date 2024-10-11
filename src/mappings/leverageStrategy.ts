import { BigInt, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  StrategyProxyCreated,
  ExitQueueEntered,
  ExitedAssetsClaimed,
} from '../../generated/AaveLeverageStrategy/AaveLeverageStrategy'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadLeverageStrategyPosition,
  snapshotLeverageStrategyPosition,
  updateLeverageStrategyPosition,
} from '../entities/leverageStrategy'
import { convertOsTokenSharesToAssets, createOrLoadOsToken } from '../entities/osToken'

export function handleStrategyProxyCreated(event: StrategyProxyCreated): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const proxyAddress = event.params.proxy

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  position.proxy = proxyAddress
  position.save()

  log.info('[LeverageStrategy] StrategyProxyCreated vault={} user={} proxy={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    proxyAddress.toHex(),
  ])
}

export function handleDeposited(event: Deposited): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const depositedOsTokenShares = event.params.osTokenShares

  const osToken = createOrLoadOsToken()
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)

  updateLeverageStrategyPosition(position)
  position.save()

  const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const osTokenAssetsAfter = convertOsTokenSharesToAssets(osToken, osTokenSharesAfter)
  const assetsAfter = position.assets.plus(position.exitingAssets)

  const assetsDiff = assetsAfter.minus(assetsBefore)
  const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore).minus(depositedOsTokenShares)

  const earnedAssets = assetsAfter
    .plus(osTokenAssetsAfter)
    .minus(convertOsTokenSharesToAssets(osToken, depositedOsTokenShares))
    .minus(convertOsTokenSharesToAssets(osToken, osTokenSharesBefore))
    .minus(assetsBefore)
  const earnedBoostAssets = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)

  snapshotLeverageStrategyPosition(
    position,
    earnedAssets,
    earnedBoostAssets,
    osTokenAssetsAfter.plus(assetsAfter),
    event.block.timestamp,
  )

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] Deposited vault={} user={} osTokenShares={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    depositedOsTokenShares.toString(),
  ])
}

export function handleExitQueueEntered(event: ExitQueueEntered): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const positionTicket = event.params.positionTicket
  const exitingPercent = event.params.positionPercent

  const osToken = createOrLoadOsToken()
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  position.exitRequest = `${vaultAddress}-${positionTicket}`
  position.exitingPercent = exitingPercent

  updateLeverageStrategyPosition(position)
  position.save()

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

  snapshotLeverageStrategyPosition(
    position,
    earnedAssets,
    earnedBoostAssets,
    osTokenAssetsAfter.plus(assetsAfter),
    event.block.timestamp,
  )

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] ExitQueueEntered vault={} user={} positionTicket={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    positionTicket.toString(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const claimedOsTokenShares = event.params.osTokenShares
  const claimedAssets = event.params.assets

  const osToken = createOrLoadOsToken()
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  position.exitRequest = null
  position.exitingPercent = BigInt.zero()

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)

  updateLeverageStrategyPosition(position)
  position.save()

  const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const osTokenAssetsAfter = convertOsTokenSharesToAssets(osToken, osTokenSharesAfter)
  const assetsAfter = position.assets.plus(position.exitingAssets)

  const assetsDiff = assetsAfter.plus(claimedAssets).minus(assetsBefore)
  const osTokenSharesDiff = osTokenSharesAfter.plus(claimedOsTokenShares).minus(osTokenSharesBefore)

  const earnedAssets = assetsAfter
    .plus(osTokenAssetsAfter)
    .plus(claimedAssets)
    .plus(convertOsTokenSharesToAssets(osToken, claimedOsTokenShares))
    .minus(convertOsTokenSharesToAssets(osToken, osTokenSharesBefore))
    .minus(assetsBefore)
  const earnedBoostAssets = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)

  snapshotLeverageStrategyPosition(
    position,
    earnedAssets,
    earnedBoostAssets,
    osTokenAssetsAfter.plus(assetsAfter),
    event.block.timestamp,
  )

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] ExitedAssetsClaimed vault={} user={}', [vaultAddress.toHex(), userAddress.toHex()])
}
