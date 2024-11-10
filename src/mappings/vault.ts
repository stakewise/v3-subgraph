import { Address, BigDecimal, BigInt, ipfs, json, log } from '@graphprotocol/graph-ts'

import { ExitRequest, Vault } from '../../generated/schema'
import { BlocklistVault as BlocklistVaultTemplate, Vault as VaultTemplate } from '../../generated/templates'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered as V1ExitQueueEntered,
  FeeRecipientUpdated,
  FeeSharesMinted,
  Initialized,
  KeysManagerUpdated,
  MetadataUpdated,
  OsTokenBurned,
  OsTokenLiquidated,
  OsTokenMinted,
  OsTokenRedeemed,
  Redeemed,
  V2ExitQueueEntered,
  ValidatorsManagerUpdated,
  ValidatorsRootUpdated,
} from '../../generated/templates/Vault/Vault'
import { GenesisVaultCreated, Migrated } from '../../generated/GenesisVault/GenesisVault'
import { EthFoxVaultCreated } from '../../generated/templates/FoxVault/FoxVault'

import { updateMetadata } from '../entities/metadata'
import { createTransaction } from '../entities/transaction'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorLtv,
  getAllocatorLtvStatus,
  getAllocatorOsTokenMintApy,
  snapshotAllocator,
} from '../entities/allocator'
import { createOrLoadNetwork, decreaseUserVaultsCount, increaseUserVaultsCount } from '../entities/network'
import { convertSharesToAssets, snapshotVault } from '../entities/vaults'
import { convertOsTokenSharesToAssets, createOrLoadOsToken, snapshotOsToken } from '../entities/osToken'
import { DEPOSIT_DATA_REGISTRY, WAD } from '../helpers/constants'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { snapshotExitRequest, updateExitRequests } from '../entities/exitRequests'

// Event emitted on assets transfer from allocator to vault
export function handleDeposited(event: Deposited): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const receiver = params.receiver
  const vaultAddress = event.address
  const timestamp = event.block.timestamp

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  const isVaultCreation = vault.totalShares.isZero() && vault.totalAssets.isZero()
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()
  snapshotVault(vault, BigInt.zero(), timestamp)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.plus(assets)
  network.save()

  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  if (allocator.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(receiver)
  }
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  const txHash = event.transaction.hash.toHex()

  if (isVaultCreation) {
    createAllocatorAction(event, vaultAddress, AllocatorActionType.VaultCreated, receiver, assets, shares)
  } else {
    createAllocatorAction(event, vaultAddress, AllocatorActionType.Deposited, receiver, assets, shares)
  }

  createTransaction(txHash)

  log.info('[Vault] Deposited vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}

// Event emitted on assets withdraw from vault to allocator (deprecated)
export function handleRedeemed(event: Redeemed): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const owner = params.owner
  const vaultAddress = event.address
  const timestamp = event.block.timestamp

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.minus(assets)
  vault.totalShares = vault.totalShares.minus(shares)
  vault.save()
  snapshotVault(vault, BigInt.zero(), timestamp)

  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.minus(assets)
  network.save()

  const allocator = createOrLoadAllocator(owner, vaultAddress)
  allocator.shares = allocator.shares.minus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  if (allocator.shares.isZero()) {
    decreaseUserVaultsCount(allocator.address)
  }

  const txHash = event.transaction.hash.toHex()

  createAllocatorAction(event, vaultAddress, AllocatorActionType.Redeemed, owner, assets, shares)

  createTransaction(txHash)

  log.info('[Vault] Redeemed vault={} owner={} assets={} shares={}', [
    vaultAddress.toHex(),
    owner.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}

// Event emitted on metadata IPFS hash update
export function handleMetadataUpdated(event: MetadataUpdated): void {
  const params = event.params

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.metadataIpfsHash = params.metadataIpfsHash
  vault.metadataUpdatedAt = event.block.timestamp

  vault.description = ''
  vault.displayName = ''
  vault.imageUrl = ''

  const data = ipfs.cat(params.metadataIpfsHash)

  if (data) {
    const parsedJson = json.try_fromBytes(data)

    if (parsedJson.isOk && !parsedJson.isError) {
      updateMetadata(parsedJson.value, vault)
    }
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] MetadataUpdated metadataIpfsHash={}', [params.metadataIpfsHash])
}

// Event emitted on vault upgrade
export function handleInitialized(event: Initialized): void {
  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault
  const newVersion = event.params.version

  if (newVersion.equals(BigInt.fromI32(2))) {
    // migration to deposit manager
    vault.validatorsManager = DEPOSIT_DATA_REGISTRY
  }

  const isSecondOrHigher = newVersion.ge(BigInt.fromI32(2))

  if (isSecondOrHigher && vault.osTokenConfig == null) {
    const newOsTokenConfigVersion = '2'

    createOrLoadOsTokenConfig(newOsTokenConfigVersion)

    vault.osTokenConfig = newOsTokenConfigVersion
  }

  vault.version = newVersion

  vault.save()

  if (newVersion.equals(BigInt.fromI32(3))) {
    // update exit requests
    updateExitRequests(vault, event.block)
  }

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Initialized vault={} version={}', [vaultAddress, newVersion.toString()])
}

// Event emitted on validators root and IPFS hash update (deprecated)
export function handleValidatorsRootUpdated(event: ValidatorsRootUpdated): void {
  const params = event.params

  const validatorsRoot = params.validatorsRoot

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.depositDataRoot = validatorsRoot

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] ValidatorsRootUpdated vault={} validatorsRoot={}', [vaultAddress, validatorsRoot.toHex()])
}

// Event emitted on fee recipient update
export function handleFeeRecipientUpdated(event: FeeRecipientUpdated): void {
  const params = event.params

  const feeRecipient = params.feeRecipient

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.feeRecipient = feeRecipient

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] FeeRecipientUpdated vault={} feeRecipient={}', [vaultAddress, feeRecipient.toHex()])
}

// Event emitted on keys manager update (deprecated)
export function handleKeysManagerUpdated(event: KeysManagerUpdated): void {
  const params = event.params

  const keysManager = params.keysManager

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.depositDataManager = keysManager

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] KeysManagerUpdated vault={} keysManager={}', [vaultAddress, keysManager.toHex()])
}

// Event emitted on validators manager update
export function handleValidatorsManagerUpdated(event: ValidatorsManagerUpdated): void {
  const params = event.params

  const validatorsManager = params.validatorsManager

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.validatorsManager = validatorsManager

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] ValidatorsManagerUpdated vault={} validatorsManager={}', [vaultAddress, validatorsManager.toHex()])
}

// Event emitted when an allocator enters the V1 exit queue. (deprecated)
// Shares locked, but assets can't be claimed until shares burned (on CheckpointCreated event)
export function handleV1ExitQueueEntered(event: V1ExitQueueEntered): void {
  const params = event.params

  const owner = params.owner
  const receiver = params.receiver
  const positionTicket = params.positionTicket
  const shares = params.shares
  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault
  const assets = convertSharesToAssets(vault, shares)
  const timestamp = event.block.timestamp

  // if it's ERC-20 vault shares are updated in Transfer event handler
  if (!vault.isErc20) {
    const osToken = createOrLoadOsToken()
    const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
    const allocator = createOrLoadAllocator(owner, event.address)
    allocator.shares = allocator.shares.minus(shares)
    allocator.assets = convertSharesToAssets(vault, allocator.shares)
    allocator.ltv = getAllocatorLtv(allocator, osToken)
    allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
    allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
    allocator.save()

    snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

    if (allocator.shares.isZero()) {
      decreaseUserVaultsCount(allocator.address)
    }
  }

  createAllocatorAction(event, event.address, AllocatorActionType.ExitQueueEntered, owner, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  vault.latestExitTicket = positionTicket.plus(shares)
  vault.queuedShares = vault.queuedShares.plus(shares)
  vault.save()

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionTicket}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalTickets = shares
  exitRequest.totalAssets = assets
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.isV2Position = false
  exitRequest.exitQueueIndex = null
  exitRequest.timestamp = timestamp
  exitRequest.isClaimable = false
  exitRequest.isClaimed = false
  exitRequest.lastSnapshotTimestamp = timestamp
  exitRequest.save()

  log.info('[Vault] V1ExitQueueEntered vault={} owner={} shares={}', [vaultAddress, owner.toHex(), shares.toString()])
}

// Event emitted when an allocator enters the V2 exit queue.
// Shares are burned, but assets can't be claimed until available in vault
export function handleV2ExitQueueEntered(event: V2ExitQueueEntered): void {
  const params = event.params

  const owner = params.owner
  const receiver = params.receiver
  const positionTicket = params.positionTicket
  const shares = params.shares
  const assets = params.assets
  const vaultAddress = event.address.toHex()
  const timestamp = event.block.timestamp

  // Update vault shares and assets
  const vault = Vault.load(vaultAddress) as Vault
  vault.totalShares = vault.totalShares.minus(shares)
  vault.totalAssets = vault.totalAssets.minus(assets)
  let exitingTickets: BigInt
  if (vault.exitingAssets.le(BigInt.zero())) {
    exitingTickets = assets
  } else {
    exitingTickets = assets.times(vault.exitingTickets).div(vault.exitingAssets)
  }
  vault.exitingAssets = vault.exitingAssets.plus(assets)
  vault.exitingTickets = vault.exitingTickets.plus(exitingTickets)
  vault.latestExitTicket = positionTicket.plus(exitingTickets)
  vault.save()
  snapshotVault(vault, BigInt.zero(), timestamp)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.minus(assets)
  network.save()

  // Update allocator shares
  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  const allocator = createOrLoadAllocator(owner, event.address)
  allocator.shares = allocator.shares.minus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  if (allocator.shares.isZero()) {
    decreaseUserVaultsCount(allocator.address)
  }

  createAllocatorAction(event, event.address, AllocatorActionType.ExitQueueEntered, owner, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionTicket}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalTickets = exitingTickets
  exitRequest.totalAssets = assets
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.isV2Position = true
  exitRequest.exitQueueIndex = null
  exitRequest.timestamp = timestamp
  exitRequest.isClaimable = false
  exitRequest.isClaimed = false
  exitRequest.lastSnapshotTimestamp = timestamp
  exitRequest.save()
  snapshotExitRequest(exitRequest, BigInt.zero(), timestamp)

  log.info('[Vault] V2ExitQueueEntered vault={} owner={} shares={} assets={}', [
    vaultAddress,
    owner.toHex(),
    shares.toString(),
    assets.toString(),
  ])
}

// Event emitted when an allocator claim assets partially or completely.
// If assets are claimed completely ExitQueueRequest will be deleted
export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const params = event.params

  const receiver = params.receiver
  const prevPositionTicket = params.prevPositionTicket
  const newPositionTicket = params.newPositionTicket
  const claimedAssets = params.withdrawnAssets
  const vaultAddress = event.address.toHex()
  const timestamp = event.block.timestamp

  createAllocatorAction(event, event.address, AllocatorActionType.ExitedAssetsClaimed, receiver, claimedAssets, null)

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequestId = `${vaultAddress}-${prevPositionTicket}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  let claimedTickets: BigInt
  const isExitQueueRequestResolved = newPositionTicket.equals(BigInt.zero())
  if (isExitQueueRequestResolved) {
    claimedTickets = prevExitRequest.totalTickets
  } else {
    claimedTickets = newPositionTicket.minus(prevPositionTicket)
  }

  if (prevExitRequest.isV2Position) {
    // Update vault shares and assets
    const vault = Vault.load(vaultAddress) as Vault
    vault.exitingAssets = vault.exitingAssets.minus(claimedAssets)
    vault.exitingTickets = vault.exitingTickets.minus(claimedTickets)
    vault.save()
  }

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddress}-${newPositionTicket}`
    const nextExitRequest = new ExitRequest(nextExitQueueRequestId)
    nextExitRequest.vault = vaultAddress
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.timestamp = prevExitRequest.timestamp
    nextExitRequest.receiver = receiver
    nextExitRequest.positionTicket = newPositionTicket
    nextExitRequest.isV2Position = prevExitRequest.isV2Position
    nextExitRequest.totalTickets = prevExitRequest.totalTickets.minus(claimedTickets)
    nextExitRequest.totalAssets = prevExitRequest.totalAssets.minus(claimedAssets)
    nextExitRequest.exitedAssets = BigInt.zero()
    nextExitRequest.exitQueueIndex = null
    nextExitRequest.isClaimable = false
    nextExitRequest.isClaimed = false
    nextExitRequest.lastSnapshotTimestamp = prevExitRequest.lastSnapshotTimestamp
    nextExitRequest.save()
    snapshotExitRequest(nextExitRequest, BigInt.zero(), timestamp)
  }

  prevExitRequest.isClaimable = false
  prevExitRequest.isClaimed = true
  prevExitRequest.save()
  snapshotExitRequest(prevExitRequest, BigInt.zero(), timestamp)

  log.info('[Vault] ExitedAssetsClaimed vault={} prevPositionTicket={} newPositionTicket={} claimedAssets={}', [
    vaultAddress,
    prevPositionTicket.toString(),
    newPositionTicket.toString(),
    claimedAssets.toString(),
  ])
}

// Event emitted when fee recipient gets shares minted as a fee
export function handleFeeSharesMinted(event: FeeSharesMinted): void {
  const params = event.params
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const receiver = params.receiver
  const assets = params.assets
  const shares = params.shares
  const timestamp = event.block.timestamp

  const vault = Vault.load(vaultAddressHex) as Vault
  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  if (allocator.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(allocator.address)
  }
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  log.info('[Vault] FeeSharesMinted vault={} receiver={} assets={} shares={}', [
    vaultAddressHex,
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}

export function handleOsTokenMinted(event: OsTokenMinted): void {
  const holder = event.params.caller
  const shares = event.params.shares
  const assets = event.params.assets

  const osToken = createOrLoadOsToken()
  osToken.totalAssets = osToken.totalAssets.plus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), event.block.timestamp)

  const vault = Vault.load(event.address.toHex()) as Vault
  const allocator = createOrLoadAllocator(holder, event.address)
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.plus(shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()

  createAllocatorAction(event, event.address, AllocatorActionType.OsTokenMinted, holder, assets, shares)
  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[Vault] OsTokenMinted holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenBurned(event: OsTokenBurned): void {
  const holder = event.params.caller
  const assets = event.params.assets
  const shares = event.params.shares

  const osToken = createOrLoadOsToken()
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), event.block.timestamp)

  const vault = Vault.load(event.address.toHex()) as Vault
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, AllocatorActionType.OsTokenBurned, holder, assets, shares)

  log.info('[Vault] OsTokenBurned holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.receivedAssets
  const vaultAddress = event.address.toHex()
  const timestamp = event.block.timestamp

  const vault = Vault.load(vaultAddress) as Vault
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.save()
  snapshotVault(vault, BigInt.zero(), timestamp)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.minus(withdrawnAssets)
  network.save()

  const osToken = createOrLoadOsToken()
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), timestamp)

  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.shares = allocator.shares.minus(withdrawnShares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  if (allocator.shares.isZero()) {
    decreaseUserVaultsCount(allocator.address)
  }

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, AllocatorActionType.OsTokenLiquidated, holder, null, shares)
  log.info('[Vault] OsTokenLiquidated holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.assets
  const vaultAddress = event.address.toHex()
  const timestamp = event.block.timestamp

  const vault = Vault.load(vaultAddress) as Vault
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.save()
  snapshotVault(vault, BigInt.zero(), timestamp)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.minus(withdrawnAssets)
  network.save()

  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()
  snapshotOsToken(osToken, BigInt.zero(), timestamp)

  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.shares = allocator.shares.minus(withdrawnShares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  if (allocator.shares.isZero()) {
    decreaseUserVaultsCount(allocator.address)
  }

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, AllocatorActionType.OsTokenRedeemed, holder, null, shares)

  log.info('[Vault] OsTokenRedeemed holder={} shares={}', [holder.toHex(), shares.toString()])
}

// Event emitted when GenesisVault is initialized
export function handleGenesisVaultCreated(event: GenesisVaultCreated): void {
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const params = event.params
  const capacity = params.capacity
  const feePercent = params.feePercent
  const admin = params.admin

  const vault = new Vault(vaultAddressHex)
  vault.admin = admin
  vault.factory = Address.zero()
  vault.capacity = capacity
  vault.feePercent = feePercent
  vault.feeRecipient = admin
  vault.depositDataManager = admin
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.canHarvest = false
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.totalAssets = BigInt.zero()
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.latestExitTicket = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = false
  vault.isErc20 = false
  vault.isRestake = false
  vault.isOsTokenEnabled = true
  vault.isCollateralized = true
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.apy = BigDecimal.zero()
  vault.apys = []
  vault.maxBoostApy = BigDecimal.zero()
  vault.maxBoostApys = []
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = true
  vault.version = BigInt.fromI32(1)
  vault.osTokenConfig = '1'

  createOrLoadOsTokenConfig('1')

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsCount = network.vaultsCount + 1
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[GenesisVault] GenesisVaultCreated address={} admin={} feePercent={} capacity={}', [
    vaultAddressHex,
    admin.toHex(),
    feePercent.toString(),
    capacity.toString(),
  ])
}

// Event emitted when FoxVault is initialized
export function handleFoxVaultCreated(event: EthFoxVaultCreated): void {
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const params = event.params
  const capacity = params.capacity
  const feePercent = params.feePercent
  const admin = params.admin
  const ownMevEscrow = params.ownMevEscrow

  const vault = new Vault(vaultAddressHex)
  vault.admin = admin
  vault.factory = Address.zero()
  vault.capacity = capacity
  vault.feePercent = feePercent
  vault.feeRecipient = admin
  vault.depositDataManager = admin
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.canHarvest = false
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.totalAssets = BigInt.zero()
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.latestExitTicket = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = true
  vault.isErc20 = false
  vault.isRestake = false
  vault.isOsTokenEnabled = false
  vault.isCollateralized = false
  vault.mevEscrow = ownMevEscrow
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.apy = BigDecimal.zero()
  vault.apys = []
  vault.maxBoostApy = BigDecimal.zero()
  vault.maxBoostApys = []
  vault.isGenesis = false
  vault.blocklistManager = admin
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.version = BigInt.fromI32(1)
  vault.osTokenConfig = '1'

  createOrLoadOsTokenConfig('1')

  vault.save()
  VaultTemplate.create(vaultAddress)
  BlocklistVaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsCount = network.vaultsCount + 1
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[FoxVault] EthFoxVaultCreated address={} admin={} feePercent={} capacity={} ownMevEscrow={}', [
    vaultAddressHex,
    admin.toHex(),
    feePercent.toString(),
    capacity.toString(),
    ownMevEscrow.toHex(),
  ])
}

// Event emitted when migrating from StakeWise v3 to GenesisVault
export function handleMigrated(event: Migrated): void {
  const params = event.params
  const vaultAddress = event.address
  const receiver = params.receiver
  const assets = params.assets
  const shares = params.shares
  const timestamp = event.block.timestamp

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()
  snapshotVault(vault, BigInt.zero(), timestamp)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.plus(assets)
  network.save()

  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  if (allocator.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(allocator.address)
  }
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
  allocator.save()
  snapshotAllocator(allocator, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, vaultAddress, AllocatorActionType.Migrated, receiver, assets, shares)

  log.info('[GenesisVault] Migrated vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}
