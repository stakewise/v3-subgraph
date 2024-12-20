import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered,
} from '../../generated/AaveLeverageStrategy/AaveLeverageStrategy'
import { StrategyProxyCreated } from '../../generated/Keeper/AaveLeverageStrategy'
import { Network, OsToken, OsTokenConfig, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadLeverageStrategyPosition,
  loadLeverageStrategyPosition,
  snapshotLeverageStrategyPosition,
  updateLeverageStrategyPosition,
} from '../entities/leverageStrategy'
import { convertOsTokenSharesToAssets, loadOsToken } from '../entities/osToken'
import { WAD } from '../helpers/constants'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorApy,
  loadAllocator,
  snapshotAllocator,
} from '../entities/allocator'
import { getOsTokenHolderApy, loadOsTokenHolder, snapshotOsTokenHolder } from '../entities/osTokenHolder'
import { loadNetwork } from '../entities/network'
import { loadVault } from '../entities/vault'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { createOrLoadAavePosition } from '../entities/aave'

function _updateAllocatorAndOsTokenHolderApys(
  network: Network,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  userAddress: Address,
  timestamp: BigInt,
): void {
  const allocator = loadAllocator(userAddress, Address.fromString(vault.id))!
  allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, allocator, false)
  allocator.save()
  snapshotAllocator(osToken, osTokenConfig, vault, allocator, BigInt.zero(), timestamp)

  const osTokenHolder = loadOsTokenHolder(userAddress)!
  osTokenHolder.apy = getOsTokenHolderApy(network, osToken, osTokenHolder, false)
  osTokenHolder.save()
  snapshotOsTokenHolder(network, osToken, osTokenHolder, BigInt.zero(), timestamp)
}

export function handleStrategyProxyCreated(event: StrategyProxyCreated): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const proxyAddress = event.params.proxy

  createOrLoadAavePosition(proxyAddress)
  createOrLoadAllocator(proxyAddress, vaultAddress)

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
  const timestamp = event.block.timestamp

  const network = loadNetwork()!
  const osToken = loadOsToken()!
  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  let position = loadLeverageStrategyPosition(vaultAddress, userAddress)
  let ignoreSnapshot = false
  if (!position) {
    // in holesky some proxies were created by untracked strategy
    ignoreSnapshot = true
    position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
    log.error('[LeverageStrategy] Deposited position not found vault={} user={}', [
      vaultAddress.toHex(),
      userAddress.toHex(),
    ])
  }

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets

  updateLeverageStrategyPosition(osToken, position)

  const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsAfter = position.assets.plus(position.exitingAssets)
  const totalAssetsAfter = position.totalAssets

  const assetsDiff = assetsAfter.minus(assetsBefore)
  const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore).minus(depositedOsTokenShares)

  const earnedAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
  const totalAssetsDiff = totalAssetsAfter.minus(totalAssetsBefore)

  position.totalEarnedAssets = position.totalEarnedAssets.plus(earnedAssetsDiff)
  position.save()

  _updateAllocatorAndOsTokenHolderApys(network, osToken, osTokenConfig, vault, userAddress, timestamp)

  if (!ignoreSnapshot) {
    snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, timestamp)
  }

  createTransaction(event.transaction.hash.toHex())

  createAllocatorAction(
    event,
    vaultAddress,
    AllocatorActionType.BoostDeposited,
    userAddress,
    convertOsTokenSharesToAssets(osToken, depositedOsTokenShares),
    depositedOsTokenShares,
  )

  log.info('[LeverageStrategy] Deposited vault={} user={} osTokenShares={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    depositedOsTokenShares.toString(),
  ])
}

export function handleExitQueueEntered(event: ExitQueueEntered): void {
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()
  const userAddress = event.params.user
  const positionTicket = event.params.positionTicket
  const exitingPercent = event.params.positionPercent
  const timestamp = event.block.timestamp

  const osToken = loadOsToken()!
  const network = loadNetwork()!
  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  let position = loadLeverageStrategyPosition(vaultAddress, userAddress)
  let ignoreSnapshot = false
  if (!position) {
    // in holesky some proxies were created by untracked strategy
    ignoreSnapshot = true
    position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
    log.error('[LeverageStrategy] ExitQueueEntered position not found vault={} user={}', [
      vaultAddress.toHex(),
      userAddress.toHex(),
    ])
  }

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets
  position.exitRequest = `${vaultAddressHex}-${positionTicket}`
  position.exitingPercent = exitingPercent

  updateLeverageStrategyPosition(osToken, position)

  const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsAfter = position.assets.plus(position.exitingAssets)
  const totalAssetsAfter = position.totalAssets

  const assetsDiff = assetsAfter.minus(assetsBefore)
  const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore)

  const earnedAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
  const totalAssetsDiff = totalAssetsAfter.minus(totalAssetsBefore)

  position.totalEarnedAssets = position.totalEarnedAssets.plus(earnedAssetsDiff)
  position.save()

  _updateAllocatorAndOsTokenHolderApys(network, osToken, osTokenConfig, vault, userAddress, timestamp)

  if (!ignoreSnapshot) {
    snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, timestamp)
  }

  log.info('[LeverageStrategy] ExitQueueEntered vault={} user={} positionTicket={}', [
    vaultAddressHex,
    userAddress.toHex(),
    positionTicket.toString(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const claimedOsTokenShares = event.params.osTokenShares
  const claimedAssets = event.params.assets
  const timestamp = event.block.timestamp

  const osToken = loadOsToken()!
  const network = loadNetwork()!
  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  let position = loadLeverageStrategyPosition(vaultAddress, userAddress)
  let ignoreSnapshot = false
  if (!position) {
    // in holesky some proxies were created by untracked strategy
    ignoreSnapshot = true
    position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
    log.error('[LeverageStrategy] ExitedAssetsClaimed position not found vault={} user={}', [
      vaultAddress.toHex(),
      userAddress.toHex(),
    ])
  }

  const positionExitPercent = position.exitingPercent
  position.exitRequest = null
  position.exitingPercent = BigInt.zero()

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets

  updateLeverageStrategyPosition(osToken, position)

  const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsAfter = position.assets.plus(position.exitingAssets)
  const totalAssetsAfter = position.totalAssets

  const assetsDiff = assetsAfter.plus(claimedAssets).minus(assetsBefore)
  const osTokenSharesDiff = osTokenSharesAfter.plus(claimedOsTokenShares).minus(osTokenSharesBefore)

  const earnedAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
  const totalAssetsDiff = totalAssetsAfter.minus(totalAssetsBefore)

  position.totalEarnedAssets = position.totalEarnedAssets
    .plus(earnedAssetsDiff)
    .times(positionExitPercent)
    .div(BigInt.fromString(WAD))
  position.save()

  _updateAllocatorAndOsTokenHolderApys(network, osToken, osTokenConfig, vault, userAddress, timestamp)

  if (!ignoreSnapshot) {
    snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, timestamp)
  }

  createAllocatorAction(
    event,
    vaultAddress,
    AllocatorActionType.BoostExitedAssetsClaimed,
    userAddress,
    convertOsTokenSharesToAssets(osToken, claimedOsTokenShares),
    claimedOsTokenShares,
  )

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] ExitedAssetsClaimed vault={} user={}', [vaultAddress.toHex(), userAddress.toHex()])
}
