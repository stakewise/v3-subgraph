import { Address, BigDecimal, BigInt, DataSourceContext, ipfs, json, log, store } from '@graphprotocol/graph-ts'

import { ExitRequest, Vault } from '../../generated/schema'
import {
  BlocklistVault as BlocklistVaultTemplate,
  OwnMevEscrow as OwnMevEscrowTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import {
  CheckpointCreated,
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered as V1ExitQueueEntered,
  V2ExitQueueEntered,
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
  ValidatorsRootUpdated,
  ValidatorsManagerUpdated,
  ExitingAssetsPenalized,
} from '../../generated/templates/Vault/Vault'
import { GenesisVaultCreated, Migrated } from '../../generated/GenesisVault/GenesisVault'
import { EthFoxVaultCreated } from '../../generated/templates/FoxVault/FoxVault'

import { updateMetadata } from '../entities/metadata'
import { createTransaction } from '../entities/transaction'
import { createAllocatorAction, createOrLoadAllocator } from '../entities/allocator'
import { createOrLoadNetwork } from '../entities/network'
import { createOrLoadOsTokenPosition, createOrLoadVaultsStat } from '../entities/vaults'
import { createOrLoadOsToken } from '../entities/osToken'
import { DEPOSIT_DATA_REGISTRY, WAD } from '../helpers/constants'

// Event emitted on assets transfer from allocator to vault
export function handleDeposited(event: Deposited): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const receiver = params.receiver
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.plus(assets)
  vaultsStat.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
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
  vault.principalAssets = vault.principalAssets.minus(assets)
  vault.totalShares = vault.totalShares.minus(shares)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(assets)
  vaultsStat.save()

  const allocator = createOrLoadAllocator(owner, vaultAddress)
  allocator.shares = allocator.shares.minus(shares)
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

  // Update vault queued shares
  const vault = Vault.load(vaultAddress) as Vault
  if (!vault.isErc20) {
    // if it's ERC-20 vault shares are updated in Transfer event handler
    const allocator = createOrLoadAllocator(owner, event.address)
    allocator.shares = allocator.shares.minus(shares)
    allocator.save()
  }

  const timestamp = event.block.timestamp

  createAllocatorAction(event, event.address, 'ExitQueueEntered', owner, null, shares)

  createTransaction(event.transaction.hash.toHex())

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionTicket}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.totalAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
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
  vault.principalAssets = vault.principalAssets.minus(assets)
  vault.exitingAssets = vault.exitingAssets.plus(assets)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(assets)
  vaultsStat.save()

  // Update allocator shares
  const allocator = createOrLoadAllocator(owner, event.address)
  allocator.shares = allocator.shares.minus(shares)
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
  exitRequest.totalShares = BigInt.zero()
  exitRequest.totalAssets = assets
  exitRequest.positionTicket = positionTicket
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
  const vaultAddress = event.address.toHex()

  createAllocatorAction(event, event.address, 'ExitedAssetsClaimed', receiver, claimedAssets, null)

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequestId = `${vaultAddress}-${prevPositionTicket}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  const isExitQueueRequestResolved = newPositionTicket.equals(BigInt.zero())
  const isV2ExitRequest = prevExitRequest.totalShares.equals(BigInt.zero())

  if (isV2ExitRequest) {
    // Update vault shares and assets
    const vault = Vault.load(vaultAddress) as Vault
    vault.exitingAssets = vault.exitingAssets.minus(claimedAssets)
    vault.save()
  }

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddress}-${newPositionTicket}`
    let withdrawnShares: BigInt = BigInt.zero()
    let withdrawnAssets: BigInt = BigInt.zero()
    if (isV2ExitRequest) {
      withdrawnAssets = claimedAssets
    } else {
      withdrawnShares = newPositionTicket.minus(prevPositionTicket)
    }

    const nextExitRequest = new ExitRequest(nextExitQueueRequestId)

    nextExitRequest.vault = vaultAddress
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.timestamp = prevExitRequest.timestamp
    nextExitRequest.receiver = receiver
    nextExitRequest.positionTicket = newPositionTicket
    nextExitRequest.totalShares = prevExitRequest.totalShares.minus(withdrawnShares)
    nextExitRequest.totalAssets = prevExitRequest.totalAssets.minus(withdrawnAssets)
    nextExitRequest.save()
  }

  store.remove('ExitRequest', prevExitRequestId)

  log.info('[Vault] ExitedAssetsClaimed vault={} withdrawnAssets={}', [vaultAddress, claimedAssets.toString()])
}

// Event emitted when shares burned. After that assets become available for claim
export function handleCheckpointCreated(event: CheckpointCreated): void {
  const params = event.params

  const burnedShares = params.shares
  const exitedAssets = params.assets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  vault.principalAssets = vault.principalAssets.minus(exitedAssets)
  vault.save()

  log.info('[Vault] CheckpointCreated vault={} burnedShares={} exitedAssets={}', [
    vaultAddress,
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

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenMinted', holder, assets, shares)

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

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenBurned', holder, assets, shares)

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
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.principalAssets = vault.principalAssets.minus(withdrawnAssets)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(withdrawnAssets)
  vaultsStat.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenLiquidated', holder, null, shares)

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
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.principalAssets = vault.principalAssets.minus(withdrawnAssets)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.minus(withdrawnAssets)
  vaultsStat.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, 'OsTokenRedeemed', holder, null, shares)

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
  vault.principalAssets = BigInt.zero()
  vault.exitingAssets = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = false
  vault.isErc20 = false
  vault.isRestake = false
  vault.isOsTokenEnabled = true
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.apySnapshotsCount = BigInt.zero()
  vault.apy = BigDecimal.zero()
  vault.weeklyApy = BigDecimal.zero()
  vault.executionApy = BigDecimal.zero()
  vault.consensusApy = BigDecimal.zero()
  vault.medianApy = BigDecimal.zero()
  vault.medianExecutionApy = BigDecimal.zero()
  vault.medianConsensusApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = true
  vault.version = BigInt.fromI32(1)
  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1
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
  vault.principalAssets = BigInt.zero()
  vault.exitingAssets = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = true
  vault.isErc20 = false
  vault.isRestake = false
  vault.isOsTokenEnabled = false
  vault.isCollateralized = false
  vault.mevEscrow = ownMevEscrow
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.apySnapshotsCount = BigInt.zero()
  vault.apy = BigDecimal.zero()
  vault.weeklyApy = BigDecimal.zero()
  vault.executionApy = BigDecimal.zero()
  vault.consensusApy = BigDecimal.zero()
  vault.medianApy = BigDecimal.zero()
  vault.medianExecutionApy = BigDecimal.zero()
  vault.medianConsensusApy = BigDecimal.zero()
  vault.isGenesis = false
  vault.blocklistManager = admin
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.version = BigInt.fromI32(1)
  vault.save()
  VaultTemplate.create(vaultAddress)
  BlocklistVaultTemplate.create(vaultAddress)

  const context = new DataSourceContext()
  context.setString('vault', vaultAddressHex)
  OwnMevEscrowTemplate.createWithContext(ownMevEscrow, context)

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1
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
  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  allocator.shares = allocator.shares.plus(shares)
  allocator.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.plus(assets)
  vaultsStat.save()

  const txHash = event.transaction.hash.toHex()

  createAllocatorAction(event, vaultAddress, 'Migrated', receiver, assets, shares)

  createTransaction(txHash)

  log.info('[GenesisVault] Migrated vault={} receiver={} assets={} shares={}', [
    vaultAddress.toHex(),
    receiver.toHex(),
    assets.toString(),
    shares.toString(),
  ])
}
