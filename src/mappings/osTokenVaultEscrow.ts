import { BigInt, log } from '@graphprotocol/graph-ts'
import {
  ExitedAssetsClaimed,
  ExitedAssetsProcessed,
  OsTokenLiquidated,
  OsTokenRedeemed,
  PositionCreated,
} from '../../generated/OsTokenVaultEscrow/OsTokenVaultEscrow'
import { getAllocatorApy, loadAllocator, updateAllocatorMintedOsTokenShares } from '../entities/allocator'
import { convertOsTokenSharesToAssets, loadOsToken } from '../entities/osToken'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { createOrLoadOsTokenExitRequest, getExitRequestLtv } from '../entities/osTokenVaultEscrow'
import { loadVault } from '../entities/vault'
import { loadDistributor } from '../entities/merkleDistributor'

export function handlePositionCreated(event: PositionCreated): void {
  const vaultAddress = event.params.vault
  const owner = event.params.owner
  const osTokenShares = event.params.osTokenShares
  const exitPositionTicket = event.params.exitPositionTicket

  const vault = loadVault(vaultAddress)!
  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const distributor = loadDistributor()!
  const allocator = loadAllocator(owner, vaultAddress)!
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(osTokenShares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  updateAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, allocator.mintedOsTokenShares)
  allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator, false)
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
  const osToken = loadOsToken()!

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

  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, osTokenShares))
  osToken.totalSupply = osToken.totalSupply.minus(osTokenShares)
  osToken.save()

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

  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, osTokenShares))
  osToken.totalSupply = osToken.totalSupply.minus(osTokenShares)
  osToken.save()

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

  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, osTokenShares))
  osToken.totalSupply = osToken.totalSupply.minus(osTokenShares)
  osToken.save()

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
