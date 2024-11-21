import { BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  ExitedAssetsClaimed,
  ExitedAssetsProcessed,
  OsTokenLiquidated,
  OsTokenRedeemed,
  PositionCreated,
} from '../../generated/OsTokenVaultEscrow/OsTokenVaultEscrow'
import { Vault } from '../../generated/schema'
import {
  createOrLoadAllocator,
  getAllocatorLtv,
  getAllocatorLtvStatus,
  getAllocatorOsTokenMintApy,
} from '../entities/allocator'
import { convertOsTokenSharesToAssets, createOrLoadOsToken, snapshotOsToken } from '../entities/osToken'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import {
  createOrLoadOsTokenExitRequest,
  getExitRequestLtv,
  updateOsTokenExitRequests,
} from '../entities/osTokenVaultEscrow'
import { createOrLoadNetwork } from '../entities/network'

export function handlePositionCreated(event: PositionCreated): void {
  const vaultAddress = event.params.vault
  const owner = event.params.owner
  const osTokenShares = event.params.osTokenShares
  const exitPositionTicket = event.params.exitPositionTicket

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  const allocator = createOrLoadAllocator(owner, vaultAddress)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(osTokenShares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken, osTokenConfig)
  allocator.save()

  const osTokenExitRequest = createOrLoadOsTokenExitRequest(vaultAddress, exitPositionTicket)
  osTokenExitRequest.owner = owner
  osTokenExitRequest.osTokenShares = osTokenShares
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
  osTokenExitRequest.save()

  log.info('[OsTokenVaultEscrow] PositionCreated vault={} owner={} exitPositionTicket={}', [
    vaultAddress.toHex(),
    owner.toHex(),
    exitPositionTicket.toHex(),
  ])
}

export function handleExitedAssetsProcessed(event: ExitedAssetsProcessed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const exitedAssets = event.params.exitedAssets

  const osTokenExitRequest = createOrLoadOsTokenExitRequest(vaultAddress, exitPositionTicket)
  const osToken = createOrLoadOsToken()

  osTokenExitRequest.exitedAssets = exitedAssets
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
  osTokenExitRequest.save()

  log.info('[OsTokenVaultEscrow] ExitedAssetsProcessed vault={} exitPositionTicket={} exitedAssets={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    exitedAssets.toHex(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const withdrawnAssets = event.params.assets

  const osToken = createOrLoadOsToken()
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, osTokenShares))
  osToken.totalSupply = osToken.totalSupply.minus(osTokenShares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), event.block.timestamp)

  const osTokenExitRequest = createOrLoadOsTokenExitRequest(vaultAddress, exitPositionTicket)
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  osTokenExitRequest.exitedAssets = osTokenExitRequest.exitedAssets!.minus(withdrawnAssets)
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
  osTokenExitRequest.save()

  log.info('[OsTokenVaultEscrow] ExitedAssetsClaimed( vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const withdrawnAssets = event.params.receivedAssets

  const osToken = createOrLoadOsToken()
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, osTokenShares))
  osToken.totalSupply = osToken.totalSupply.minus(osTokenShares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), event.block.timestamp)

  const osTokenExitRequest = createOrLoadOsTokenExitRequest(vaultAddress, exitPositionTicket)
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  osTokenExitRequest.exitedAssets = osTokenExitRequest.exitedAssets!.minus(withdrawnAssets)
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
  osTokenExitRequest.save()

  log.info('[OsTokenVaultEscrow] OsTokenLiquidated vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const withdrawnAssets = event.params.receivedAssets

  const osToken = createOrLoadOsToken()
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, osTokenShares))
  osToken.totalSupply = osToken.totalSupply.minus(osTokenShares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), event.block.timestamp)

  const osTokenExitRequest = createOrLoadOsTokenExitRequest(vaultAddress, exitPositionTicket)
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  osTokenExitRequest.exitedAssets = osTokenExitRequest.exitedAssets!.minus(withdrawnAssets)
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
  osTokenExitRequest.save()

  log.info('[OsTokenVaultEscrow] OsTokenRedeemed vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenExitRequests(block: ethereum.Block): void {
  const network = createOrLoadNetwork()
  let vault: Vault
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    updateOsTokenExitRequests(vault)
  }
  log.info('[OsTokenExitRequests] Sync osToken exit requests at block={}', [block.number.toString()])
}
