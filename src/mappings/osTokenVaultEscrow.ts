import { BigInt, log } from '@graphprotocol/graph-ts'
import { PositionCreated, ExitedAssetsClaimed } from '../../generated/OsTokenVaultEscrow/OsTokenVaultEscrow'
import { Vault } from '../../generated/schema'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorLtv,
  getAllocatorLtvStatus,
  getAllocatorOsTokenMintApy,
} from '../entities/allocator'
import { convertOsTokenSharesToAssets, createOrLoadOsToken, snapshotOsToken } from '../entities/osToken'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { createTransaction } from '../entities/transaction'

export function handlePositionCreated(event: PositionCreated): void {
  const params = event.params
  const vaultAddress = params.vault
  const owner = params.owner
  const osTokenShares = params.osTokenShares

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
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()

  log.info('[OsTokenVaultEscrow] PositionCreated vault={} owner={} shares={}', [
    vaultAddress.toHex(),
    owner.toHex(),
    osTokenShares.toString(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const params = event.params
  const holder = params.receiver
  const shares = params.osTokenShares
  const vaultAddress = params.vault

  const osToken = createOrLoadOsToken()
  const assets = convertOsTokenSharesToAssets(osToken, shares)
  osToken.totalAssets = osToken.totalAssets.minus(assets)
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), event.block.timestamp)

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, vaultAddress, AllocatorActionType.OsTokenBurned, holder, assets, shares)

  log.info('[OsTokenVaultEscrow] ExitedAssetsClaimed vault={} holder={} shares={}', [
    vaultAddress.toHex(),
    holder.toHex(),
    shares.toString(),
  ])
}
