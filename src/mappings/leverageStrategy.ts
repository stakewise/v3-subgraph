import { BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  StrategyProxyCreated,
  ExitQueueEntered,
  ExitedAssetsClaimed,
} from '../../generated/AaveLeverageStrategy/AaveLeverageStrategy'
import {
  PositionCreated,
  ExitedAssetsProcessed,
  ExitedAssetsClaimed as OsTokenExitedAssetsClaimed,
  OsTokenLiquidated,
  OsTokenRedeemed,
} from '../../generated/AaveLeverageStrategy/OsTokenVaultEscrow'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadLeverageStrategyPosition,
  snapshotLeverageStrategyPosition,
  updateLeverageStrategyPosition,
  updateLeverageStrategyPositions,
} from '../entities/leverageStrategy'
import { convertOsTokenSharesToAssets, createOrLoadOsToken, createOsTokenExitRequest } from '../entities/osToken'
import { createOrLoadNetwork } from '../entities/network'
import { ExitRequest, OsToken, OsTokenExitRequest, Vault } from '../../generated/schema'
import { WAD } from '../helpers/constants'

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
  position.totalEarnedBoostAssets = position.totalEarnedBoostAssets.plus(earnedBoostAssets)
  position.save()

  snapshotLeverageStrategyPosition(
    position,
    earnedAssets,
    osTokenAssetsAfter.plus(assetsAfter),
    earnedBoostAssets,
    position.totalEarnedBoostAssets,
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
  const positionExitPercent = position.exitingPercent
  position.exitRequest = null
  position.exitingPercent = BigInt.zero()

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)

  updateLeverageStrategyPosition(position)

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
  position.totalEarnedBoostAssets = position.totalEarnedBoostAssets
    .times(positionExitPercent)
    .div(BigInt.fromString(WAD))
  position.totalEarnedBoostAssets = position.totalEarnedBoostAssets.plus(earnedBoostAssets)
  position.save()

  snapshotLeverageStrategyPosition(
    position,
    earnedAssets,
    osTokenAssetsAfter.plus(assetsAfter),
    earnedBoostAssets,
    position.totalEarnedBoostAssets,
    event.block.timestamp,
  )

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] ExitedAssetsClaimed vault={} user={}', [vaultAddress.toHex(), userAddress.toHex()])
}

export function handleLeverageStrategyPositions(block: ethereum.Block): void {
  const network = createOrLoadNetwork()
  let vault: Vault
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    updateLeverageStrategyPositions(vault, block.timestamp)
  }
  log.info('[LeverageStrategyPositions] Sync leverage strategy positions at block={}', [block.number.toString()])
}

export function getExitRequestLtv(
  osTokenShares: BigInt,
  exitedAssets: BigInt | null,
  totalAssets: BigInt,
  osToken: OsToken,
): BigDecimal {
  if (totalAssets.isZero() && exitedAssets && exitedAssets.isZero()) {
    return BigDecimal.zero()
  }
  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, osTokenShares)
  let assets = totalAssets
  if (exitedAssets) {
    assets = exitedAssets
  }
  return new BigDecimal(mintedOsTokenAssets).div(new BigDecimal(assets))
}

export function handlePositionCreated(event: PositionCreated): void {
  const vaultAddress = event.params.vault
  const owner = event.params.owner
  const osTokenShares = event.params.osTokenShares
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = createOsTokenExitRequest(osTokenExitRequestId, vaultAddress, owner)
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  const osToken = createOrLoadOsToken()
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenShares, exitRequest.exitedAssets, exitRequest.totalAssets, osToken)
  osTokenExitRequest.osTokenShares = osTokenShares
  osTokenExitRequest.save()

  log.info('[LeverageStrategy] osTokenExitRequestCreated vault={} owner={} exitPositionTicket={}', [
    vaultAddress.toHex(),
    owner.toHex(),
    exitPositionTicket.toHex(),
  ])
}

export function handleExitedAssetsProcessed(event: ExitedAssetsProcessed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const exitedAssets = event.params.exitedAssets
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[Keeper] Harvested vault={} not found', [osTokenExitRequestId])
    return
  }
  let ass = osTokenExitRequest.exitedAssets
  if (ass === null) {
    ass = BigInt.zero()
  }
  osTokenExitRequest.exitedAssets = ass.plus(exitedAssets)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )

  osTokenExitRequest.save()

  log.info('[LeverageStrategy] ExitedAssetsProcessed vault={} exitPositionTicket={} exitedAssets={}', [
    vaultAddress.toHex(),
    exitedAssets.toHex(),
  ])
}

export function handleOsTokenExitedAssetsClaimed(event: OsTokenExitedAssetsClaimed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[Keeper] Harvested vault={} not found', [osTokenExitRequestId])
    return
  }
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )
  osTokenExitRequest.save()

  log.info('[LeverageStrategy] OsTokenExitedAssetsClaimed vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[Keeper] Harvested vault={} not found', [osTokenExitRequestId])
    return
  }
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )
  osTokenExitRequest.save()

  log.info('[LeverageStrategy] OsTokenLiquidated vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[Keeper] Harvested vault={} not found', [osTokenExitRequestId])
    return
  }
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )
  osTokenExitRequest.save()

  log.info('[LeverageStrategy] OsTokenRedeemed vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}
