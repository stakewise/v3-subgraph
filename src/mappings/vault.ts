import { Address, BigDecimal, BigInt, ipfs, json, log, store } from '@graphprotocol/graph-ts'

import { AllocatorAction, ExitRequest, Vault } from '../../generated/schema'
import { Vault as VaultTemplate } from '../../generated/templates'
import {
  CheckpointCreated,
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered,
  FeeRecipientUpdated,
  FeeSharesMinted,
  KeysManagerUpdated,
  MetadataUpdated,
  OsTokenBurned,
  OsTokenLiquidated,
  OsTokenMinted,
  OsTokenRedeemed,
  Redeemed,
  ValidatorsRootUpdated,
} from '../../generated/templates/Vault/Vault'
import { GenesisVaultCreated, Migrated } from '../../generated/GenesisVault/GenesisVault'

import { updateMetadata } from '../entities/metadata'
import { createTransaction } from '../entities/transaction'
import { createOrLoadAllocator } from '../entities/allocator'
import { createOrLoadDaySnapshot } from '../entities/daySnapshot'
import { createOrLoadNetwork } from '../entities/network'
import { createOrLoadOsTokenPosition, createOrLoadVaultStats } from '../entities/vaults'
import { createOrLoadOsToken } from '../entities/osToken'

// Event emitted on assets transfer from allocator to vault
export function handleDeposited(event: Deposited): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const receiver = params.receiver
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.totalAssets = vaultStats.totalAssets.plus(assets)
  vaultStats.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = params.caller == Address.fromBytes(vault.factory) ? 'VaultCreated' : 'Deposited'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(txHash)

  log.info('[Vault] Deposited vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}

// Event emitted on assets withdraw from vault to allocator
export function handleRedeemed(event: Redeemed): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const owner = params.owner
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.minus(assets)
  vault.principalAssets = vault.principalAssets.minus(assets)
  vault.totalShares = vault.totalShares.minus(shares)
  vault.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.totalAssets = vaultStats.totalAssets.minus(assets)
  vaultStats.save()

  const allocator = createOrLoadAllocator(owner, vaultAddress)
  allocator.shares = allocator.shares.minus(shares)
  allocator.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'Redeemed'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

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
  const data = ipfs.cat(params.metadataIpfsHash)

  if (data) {
    const parsedJson = json.try_fromBytes(data)

    if (parsedJson.isOk && !parsedJson.isError) {
      updateMetadata(parsedJson.value, vault)
      vault.metadataUpdatedAt = event.block.timestamp
    }
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] MetadataUpdated metadataIpfsHash={}', [params.metadataIpfsHash])
}

// Event emitted on validators root and IPFS hash update
export function handleValidatorsRootUpdated(event: ValidatorsRootUpdated): void {
  const params = event.params

  const validatorsRoot = params.validatorsRoot

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.validatorsRoot = validatorsRoot

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

// Event emitted on keys manager update
export function handleKeysManagerUpdated(event: KeysManagerUpdated): void {
  const params = event.params

  const keysManager = params.keysManager

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.keysManager = keysManager

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] KeysManagerUpdated vault={} keysManager={}', [vaultAddress, keysManager.toHex()])
}

// Event emitted when an allocator enters the exit queue.
// Shares locked, but assets can't be claimed until shares burned (on CheckpointCreated event)
export function handleExitQueueEntered(event: ExitQueueEntered): void {
  const params = event.params

  const owner = params.owner
  const shares = params.shares
  const receiver = params.receiver
  const positionTicket = params.positionTicket
  const vaultAddress = event.address.toHex()

  // Update vault queued shares
  const vault = Vault.load(vaultAddress) as Vault

  vault.queuedShares = vault.queuedShares.plus(shares)
  vault.save()

  if (!vault.isErc20) {
    // if it's ERC-20 vault shares are updated in Transfer event handler
    const allocator = createOrLoadAllocator(owner, event.address)
    allocator.shares = allocator.shares.minus(shares)
    allocator.save()
  }

  const txHash = event.transaction.hash.toHex()
  const timestamp = event.block.timestamp

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'ExitQueueEntered'
  allocatorAction.assets = null
  allocatorAction.shares = params.shares
  allocatorAction.createdAt = timestamp
  allocatorAction.save()

  createTransaction(event.transaction.hash.toHex())

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionTicket}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.positionTicket = positionTicket
  exitRequest.timestamp = timestamp
  exitRequest.save()

  log.info('[Vault] ExitQueueEntered vault={} owner={} shares={}', [vaultAddress, owner.toHex(), shares.toString()])
}

// Event emitted when an allocator claim assets partially or completely.
// If assets are claimed completely ExitQueueRequest will be deleted
export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const params = event.params

  const receiver = params.receiver
  const prevPositionTicket = params.prevPositionTicket
  const newPositionTicket = params.newPositionTicket
  const withdrawnAssets = params.withdrawnAssets
  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.unclaimedAssets = vault.unclaimedAssets.minus(withdrawnAssets)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'ExitedAssetsClaimed'
  allocatorAction.assets = withdrawnAssets
  allocatorAction.shares = null
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequestId = `${vaultAddress}-${prevPositionTicket}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  const isExitQueueRequestResolved = newPositionTicket.equals(BigInt.zero())

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddress}-${newPositionTicket}`
    const withdrawnShares = newPositionTicket.minus(prevPositionTicket)
    const totalShares = prevExitRequest.totalShares.minus(withdrawnShares)

    const nextExitRequest = new ExitRequest(nextExitQueueRequestId)

    nextExitRequest.vault = vaultAddress
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.timestamp = prevExitRequest.timestamp
    nextExitRequest.receiver = receiver
    nextExitRequest.positionTicket = newPositionTicket
    nextExitRequest.totalShares = totalShares
    nextExitRequest.save()
  }

  store.remove('ExitRequest', prevExitRequestId)

  log.info('[Vault] ExitedAssetsClaimed vault={} withdrawnAssets={}', [vaultAddress, withdrawnAssets.toString()])
}

// Event emitted when shares burned. After that assets become available for claim
export function handleCheckpointCreated(event: CheckpointCreated): void {
  const params = event.params

  const burnedShares = params.shares
  const exitedAssets = params.assets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(exitedAssets)
  daySnapshot.save()

  vault.totalShares = vault.totalShares.minus(burnedShares)
  vault.queuedShares = vault.queuedShares.minus(burnedShares)
  vault.totalAssets = vault.totalAssets.minus(exitedAssets)
  vault.principalAssets = vault.principalAssets.minus(exitedAssets)
  vault.unclaimedAssets = vault.unclaimedAssets.plus(exitedAssets)
  vault.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.totalAssets = vaultStats.totalAssets.minus(exitedAssets)
  vaultStats.save()

  // queued shares are burned
  const allocator = createOrLoadAllocator(event.address, event.address)
  allocator.shares = allocator.shares.minus(burnedShares)
  allocator.save()

  log.info('[Vault] CheckpointCreated burnedShares={} exitedAssets={}', [
    burnedShares.toString(),
    exitedAssets.toString(),
  ])
}

// Event emitted when fee recipient gets shares minted as a fee
export function handleFeeSharesMinted(event: FeeSharesMinted): void {
  const params = event.params
  const vaultAddress = event.address
  const receiver = params.receiver
  const assets = params.assets
  const shares = params.shares

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.save()

  log.info('[Vault] FeeSharesMinted vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}

export function handleOsTokenMinted(event: OsTokenMinted): void {
  const holder = event.params.caller
  const shares = event.params.shares
  const assets = event.params.assets
  const vaultAddress = event.address.toHex()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)
  allocatorAction.vault = vaultAddress
  allocatorAction.address = holder
  allocatorAction.actionType = 'OsTokenMinted'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const osTokenPosition = createOrLoadOsTokenPosition(holder, event.address)
  osTokenPosition.shares = osTokenPosition.shares.plus(shares)
  osTokenPosition.save()

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.save()

  log.info('[Vault] OsTokenMinted holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenBurned(event: OsTokenBurned): void {
  const holder = event.params.caller
  const assets = event.params.assets
  const shares = event.params.shares
  const vaultAddress = event.address.toHex()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)
  allocatorAction.vault = vaultAddress
  allocatorAction.address = holder
  allocatorAction.actionType = 'OsTokenBurned'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const osTokenPosition = createOrLoadOsTokenPosition(holder, event.address)
  osTokenPosition.shares = osTokenPosition.shares.lt(shares) ? BigInt.zero() : osTokenPosition.shares.minus(shares)
  osTokenPosition.save()

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()

  log.info('[Vault] OsTokenBurned holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.receivedAssets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(withdrawnAssets)
  daySnapshot.save()

  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.principalAssets = vault.principalAssets.minus(withdrawnAssets)
  vault.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.totalAssets = vaultStats.totalAssets.minus(withdrawnAssets)
  vaultStats.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vaultAddress
  allocatorAction.address = holder
  allocatorAction.actionType = 'OsTokenLiquidated'
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const osTokenPosition = createOrLoadOsTokenPosition(holder, event.address)
  osTokenPosition.shares = osTokenPosition.shares.lt(shares) ? BigInt.zero() : osTokenPosition.shares.minus(shares)
  osTokenPosition.save()

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()

  log.info('[Vault] OsTokenLiquidated holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.assets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(withdrawnAssets)
  daySnapshot.save()

  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.principalAssets = vault.principalAssets.minus(withdrawnAssets)
  vault.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.totalAssets = vaultStats.totalAssets.minus(withdrawnAssets)
  vaultStats.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vaultAddress
  allocatorAction.address = holder
  allocatorAction.actionType = 'OsTokenRedeemed'
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const osTokenPosition = createOrLoadOsTokenPosition(holder, event.address)
  osTokenPosition.shares = osTokenPosition.shares.lt(shares) ? BigInt.zero() : osTokenPosition.shares.minus(shares)
  osTokenPosition.save()

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()

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
  vault.keysManager = admin
  vault.avgRewardPerAsset = BigDecimal.zero()
  vault.totalShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.unclaimedAssets = BigInt.zero()
  vault.principalAssets = BigInt.zero()
  vault.isPrivate = false
  vault.isErc20 = false
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.isGenesis = true
  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1
  network.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.vaultsCount = vaultStats.vaultsCount.plus(BigInt.fromI32(1))
  vaultStats.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[GenesisVault] GenesisVaultCreated address={} admin={} feePercent={} capacity={}', [
    vaultAddressHex,
    admin.toHex(),
    feePercent.toString(),
    capacity.toString(),
  ])
}

// Event emitted when migrating from StakeWise v3 to GenesisVault
export function handleMigrated(event: Migrated): void {
  const params = event.params
  const vaultAddress = event.address
  const receiver = params.receiver
  const assets = params.assets
  const shares = params.shares

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.save()

  const vaultStats = createOrLoadVaultStats()
  vaultStats.totalAssets = vaultStats.totalAssets.plus(assets)
  vaultStats.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'Migrated'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(txHash)

  log.info('[GenesisVault] Migrated vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}
