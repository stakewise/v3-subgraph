import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered,
  StrategyProxyCreated,
} from '../../generated/AaveLeverageStrategy/AaveLeverageStrategy'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadLeverageStrategyPosition,
  snapshotLeverageStrategyPosition,
  updateLeverageStrategyPosition,
  updateLeverageStrategyPositions,
} from '../entities/leverageStrategy'
import {
  convertOsTokenSharesToAssets,
  createOrLoadOsToken,
  createOrLoadOsTokenHolder,
  getOsTokenHolderApy,
  updateOsTokenHoldersApy,
} from '../entities/osToken'
import { createOrLoadNetwork } from '../entities/network'
import { OsToken, Vault } from '../../generated/schema'
import { WAD } from '../helpers/constants'
import { createOrLoadAllocator, getAllocatorApy, updateVaultAllocatorsApy } from '../entities/allocator'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'

function _updateAllocatorAndOsTokenHolderApys(userAddress: Address, vaultAddress: Address, osToken: OsToken): void {
  const allocator = createOrLoadAllocator(userAddress, vaultAddress)
  const vault = Vault.load(vaultAddress.toHex()) as Vault
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  allocator.apy = getAllocatorApy(allocator, vault, osToken, osTokenConfig)
  allocator.save()

  const network = createOrLoadNetwork()
  const osTokenHolder = createOrLoadOsTokenHolder(osToken, userAddress)
  osTokenHolder.apy = getOsTokenHolderApy(network, osToken, osTokenHolder)
  osTokenHolder.save()
}

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
  const totalAssetsBefore = position.totalAssets

  updateLeverageStrategyPosition(position)

  const osTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsAfter = position.assets.plus(position.exitingAssets)
  const totalAssetsAfter = position.totalAssets

  const assetsDiff = assetsAfter.minus(assetsBefore)
  const osTokenSharesDiff = osTokenSharesAfter.minus(osTokenSharesBefore).minus(depositedOsTokenShares)

  const earnedAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenSharesDiff).plus(assetsDiff)
  const totalAssetsDiff = totalAssetsAfter.minus(totalAssetsBefore)

  position.totalEarnedAssets = position.totalEarnedAssets.plus(earnedAssetsDiff)
  position.save()

  _updateAllocatorAndOsTokenHolderApys(userAddress, vaultAddress, osToken)

  snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, event.block.timestamp)

  createTransaction(event.transaction.hash.toHex())

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

  const osToken = createOrLoadOsToken()
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets
  position.exitRequest = `${vaultAddressHex}-${positionTicket}`
  position.exitingPercent = exitingPercent

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

  _updateAllocatorAndOsTokenHolderApys(userAddress, vaultAddress, osToken)

  snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, event.block.timestamp)

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

  const osToken = createOrLoadOsToken()
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  const positionExitPercent = position.exitingPercent
  position.exitRequest = null
  position.exitingPercent = BigInt.zero()

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets

  updateLeverageStrategyPosition(position)

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

  _updateAllocatorAndOsTokenHolderApys(userAddress, vaultAddress, osToken)

  snapshotLeverageStrategyPosition(position, totalAssetsDiff, earnedAssetsDiff, event.block.timestamp)

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] ExitedAssetsClaimed vault={} user={}', [vaultAddress.toHex(), userAddress.toHex()])
}

export function handleLeverageStrategyPositions(block: ethereum.Block): void {
  const network = createOrLoadNetwork()
  const osToken = createOrLoadOsToken()
  let vault: Vault
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    updateLeverageStrategyPositions(vault, block.timestamp)
    updateVaultAllocatorsApy(vault, osToken, createOrLoadOsTokenConfig(vault.osTokenConfig))
  }
  updateOsTokenHoldersApy(network, osToken)
  log.info('[LeverageStrategyPositions] Sync leverage strategy positions at block={}', [block.number.toString()])
}
