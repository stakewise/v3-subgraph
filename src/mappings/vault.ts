import { Address, BigDecimal, BigInt, ipfs, json, log, store } from '@graphprotocol/graph-ts'

import { ExitRequest, Vault } from '../../generated/schema'
import { BlocklistVault as BlocklistVaultTemplate, Vault as VaultTemplate } from '../../generated/templates'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitingAssetsPenalized,
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
import { createAllocatorAction, createOrLoadAllocator, updateAllocatorLtv } from '../entities/allocator'
import { createOrLoadNetwork } from '../entities/network'
import { convertSharesToAssets, createOrLoadVaultsStat } from '../entities/vaults'
import { createOrLoadOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { DEPOSIT_DATA_REGISTRY, WAD } from '../helpers/constants'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'

// Event emitted on assets transfer from allocator to vault
export function handleDeposited(event: Deposited): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const receiver = params.receiver
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.plus(assets)
  vaultsStat.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  updateAllocatorLtv(allocator, createOrLoadOsToken())
  allocator.save()

  const txHash = event.transaction.hash.toHex()

  createAllocatorAction(event, vaultAddress, 'Deposited', receiver, assets, shares)

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

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.minus(assets)
  vault.totalShares = vault.totalShares.minus(shares)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(assets)
  vaultsStat.save()

  const allocator = createOrLoadAllocator(owner, vaultAddress)
  allocator.shares = allocator.shares.minus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  updateAllocatorLtv(allocator, createOrLoadOsToken())
  allocator.save()

  const txHash = event.transaction.hash.toHex()

  createAllocatorAction(event, vaultAddress, 'Redeemed', owner, assets, shares)

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

  if (isSecondOrHigher) {
    const newOsTokenConfigVersion = '2'

    createOrLoadOsTokenConfig(newOsTokenConfigVersion)

    vault.osTokenConfig = newOsTokenConfigVersion
  }

  vault.version = newVersion

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Initialized vault={} version={}', [vaultAddress, newVersion.toString()])
}

// Event emitted on validators root and IPFS hash update (deprecated)
export function handleValidatorsRootUpdated(event: ValidatorsRootUpdated): void {
  const params = event.params

  const validatorsRoot = params.validatorsRoot

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.validatorsRoot = validatorsRoot
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

  vault.keysManager = keysManager
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

  // Update vault queued shares
  if (!vault.isErc20) {
    // if it's ERC-20 vault shares are updated in Transfer event handler
    const allocator = createOrLoadAllocator(owner, event.address)
    allocator.shares = allocator.shares.minus(shares)
    allocator.assets = convertSharesToAssets(vault, allocator.shares)
    updateAllocatorLtv(allocator, createOrLoadOsToken())
    allocator.save()
  }

  const timestamp = event.block.timestamp

  createAllocatorAction(event, event.address, 'ExitQueueEntered', owner, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  vault.latestExitTicket = positionTicket.plus(shares)
  vault.save()

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionTicket}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalAssets = assets
  exitRequest.claimableAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.isV2Position = false
  exitRequest.exitQueueIndex = null
  exitRequest.timestamp = timestamp
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

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(assets)
  vaultsStat.save()

  // Update allocator shares
  const allocator = createOrLoadAllocator(owner, event.address)
  allocator.shares = allocator.shares.minus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  updateAllocatorLtv(allocator, createOrLoadOsToken())
  allocator.save()

  const timestamp = event.block.timestamp

  createAllocatorAction(event, event.address, 'ExitQueueEntered', owner, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionTicket}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalAssets = assets
  exitRequest.claimableAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.isV2Position = true
  exitRequest.exitQueueIndex = null
  exitRequest.timestamp = timestamp
  exitRequest.save()

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
  const claimedTickets = prevPositionTicket.minus(newPositionTicket)
  const vaultAddress = event.address.toHex()

  createAllocatorAction(event, event.address, 'ExitedAssetsClaimed', receiver, claimedAssets, null)

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequestId = `${vaultAddress}-${prevPositionTicket}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  const isExitQueueRequestResolved = newPositionTicket.equals(BigInt.zero())
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
    nextExitRequest.totalAssets = prevExitRequest.totalAssets.minus(claimedAssets)
    nextExitRequest.claimableAssets = BigInt.zero()
    nextExitRequest.exitQueueIndex = null
    nextExitRequest.save()
  }

  store.remove('ExitRequest', prevExitRequestId)

  log.info('[Vault] ExitedAssetsClaimed vault={} withdrawnAssets={}', [vaultAddress, claimedAssets.toString()])
}

// Event emitted when fee recipient gets shares minted as a fee
export function handleFeeSharesMinted(event: FeeSharesMinted): void {
  const params = event.params
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const receiver = params.receiver
  const assets = params.assets
  const shares = params.shares

  const vault = Vault.load(vaultAddressHex) as Vault
  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  updateAllocatorLtv(allocator, createOrLoadOsToken())
  allocator.save()

  log.info('[Vault] FeeSharesMinted vault={} receiver={} assets={} shares={}', [
    vaultAddressHex,
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}

export function handleExitingAssetsPenalized(event: ExitingAssetsPenalized): void {
  const vaultAddress = event.address
  const penaltyAssets = event.params.penalty

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.exitingAssets = vault.exitingAssets.minus(penaltyAssets)
  vault.save()

  log.info('[Vault] ExitingAssetsPenalized vault={} penaltyAssets={}', [vaultAddress.toHex(), penaltyAssets.toString()])
}

export function handleOsTokenMinted(event: OsTokenMinted): void {
  const holder = event.params.caller
  const shares = event.params.shares
  const assets = event.params.assets

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.totalAssets = osToken.totalAssets.plus(assets)
  osToken.save()

  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.plus(shares)
  updateAllocatorLtv(allocator, osToken)
  allocator.save()

  createAllocatorAction(event, event.address, 'OsTokenMinted', holder, assets, shares)
  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[Vault] OsTokenMinted holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenBurned(event: OsTokenBurned): void {
  const holder = event.params.caller
  const assets = event.params.assets
  const shares = event.params.shares

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.totalAssets = osToken.totalAssets.minus(assets)
  if (osToken.totalAssets.lt(BigInt.zero())) {
    osToken.totalAssets = BigInt.zero()
  }
  osToken.save()

  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  updateAllocatorLtv(allocator, osToken)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenBurned', holder, assets, shares)

  log.info('[Vault] OsTokenBurned holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.receivedAssets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(withdrawnAssets)
  vaultsStat.save()

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  const osTokenAssetsBefore = osToken.totalAssets
  updateOsTokenTotalAssets(osToken)
  osToken.save()
  const assets = osTokenAssetsBefore.minus(osToken.totalAssets)

  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.shares = allocator.shares.minus(withdrawnShares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  updateAllocatorLtv(allocator, osToken)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenLiquidated', holder, assets, shares)
  log.info('[Vault] OsTokenLiquidated holder={} shares={}', [holder.toHex(), shares.toString()])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.assets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(withdrawnAssets)
  vaultsStat.save()

  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  const osTokenAssetsBefore = osToken.totalAssets
  updateOsTokenTotalAssets(osToken)
  osToken.save()
  const assets = osTokenAssetsBefore.minus(osToken.totalAssets)

  const allocator = createOrLoadAllocator(holder, event.address)
  allocator.shares = allocator.shares.minus(withdrawnShares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  updateAllocatorLtv(allocator, osToken)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenRedeemed', holder, assets, shares)

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
  vault.keysManager = admin // Deprecated
  vault.depositDataManager = admin
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.unconvertedExecutionReward = BigInt.zero()
  vault.canHarvest = false
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
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
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = true
  vault.version = BigInt.fromI32(1)
  vault.osTokenConfig = '1'

  createOrLoadOsTokenConfig('1')

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.vaultsCount = vaultsStat.vaultsCount.plus(BigInt.fromI32(1))
  vaultsStat.save()

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
  vault.keysManager = admin // Deprecated
  vault.depositDataManager = admin
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.unconvertedExecutionReward = BigInt.zero()
  vault.canHarvest = false
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
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
  network.vaultsTotal = network.vaultsTotal + 1
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.vaultsCount = vaultsStat.vaultsCount.plus(BigInt.fromI32(1))
  vaultsStat.save()

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

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.plus(assets)
  vaultsStat.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  updateAllocatorLtv(allocator, createOrLoadOsToken())
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, vaultAddress, 'Migrated', receiver, assets, shares)

  log.info('[GenesisVault] Migrated vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}
