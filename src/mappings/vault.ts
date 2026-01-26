import { Address, BigDecimal, BigInt, Bytes, ethereum, ipfs, json, log } from '@graphprotocol/graph-ts'

import { Allocator, ExitRequest, SubVaultsRegistryMap, Vault } from '../../generated/schema'
import {
  BlocklistVault as BlocklistVaultTemplate,
  OwnMevEscrow as OwnMevEscrowTemplate,
  SubVaultsRegistry as SubVaultsRegistryTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { MetaVault as MetaVaultContract } from '../../generated/templates/MetaVault/MetaVault'
import {
  AdminUpdated,
  AssetsDonated,
  CheckpointCreated,
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered as V1ExitQueueEntered,
  FeePercentUpdated,
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
  decreaseAllocatorMintedOsTokenShares,
  decreaseAllocatorShares,
  getAllocatorApy,
  getAllocatorId,
  increaseAllocatorMintedOsTokenShares,
  increaseAllocatorShares,
  loadAllocator,
} from '../entities/allocator'
import { isGnosisNetwork, loadNetwork } from '../entities/network'
import { convertOsTokenSharesToAssets, loadOsToken } from '../entities/osToken'
import { DEPOSIT_DATA_REGISTRY, WAD } from '../helpers/constants'
import { isSubVaultsRegistrySupported } from '../helpers/utils'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadExitRequest, updateClaimableExitRequests, updateExitRequests } from '../entities/exitRequest'
import { convertSharesToAssets, loadVault, syncVault } from '../entities/vault'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { loadAave } from '../entities/aave'
import { loadXdaiConverter } from '../entities/xdaiConverter'
import { createOrLoadV2Pool } from '../entities/v2pool'

// Event emitted on assets transfer from allocator to vault
export function handleDeposited(event: Deposited): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const receiver = params.receiver
  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!
  const isVaultCreation = vault.totalShares.isZero() && vault.totalAssets.isZero()
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.plus(assets)
  network.save()

  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const aave = loadAave()!
  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  increaseAllocatorShares(osToken, osTokenConfig, vault, allocator, shares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

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

  const vault = loadVault(vaultAddress)!
  vault.totalAssets = vault.totalAssets.minus(assets)
  vault.totalShares = vault.totalShares.minus(shares)
  vault.save()

  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.minus(assets)
  network.save()

  const aave = loadAave()!
  const allocator = loadAllocator(owner, vaultAddress)!
  decreaseAllocatorShares(osToken, osTokenConfig, vault, allocator, shares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

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

  const vaultAddress = event.address
  const vault = loadVault(vaultAddress)!

  vault.metadataIpfsHash = params.metadataIpfsHash
  vault.metadataUpdatedAt = event.block.timestamp

  vault.description = ''
  vault.displayName = ''
  vault.imageUrl = ''

  let data: Bytes | null = null
  if (params.metadataIpfsHash !== '') {
    data = ipfs.cat(params.metadataIpfsHash.trimStart().trimEnd())
  }

  if (data) {
    const parsedJson = json.try_fromBytes(data)

    if (parsedJson.isOk && !parsedJson.isError) {
      updateMetadata(parsedJson.value, vault)
    }
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] MetadataUpdated vault={} metadataIpfsHash={}', [vaultAddress.toHex(), params.metadataIpfsHash])
}

// Event emitted on vault upgrade
export function handleInitialized(event: Initialized): void {
  const timestamp = event.block.timestamp
  const vaultAddress = event.address
  const vault = loadVault(vaultAddress)!
  const newVersion = event.params.version

  if (newVersion.equals(BigInt.fromI32(2))) {
    // migration to deposit manager
    vault.validatorsManager = DEPOSIT_DATA_REGISTRY
    // update OsTokenConfig version
    vault.osTokenConfig = '2'
  }
  vault.version = newVersion

  if (newVersion.equals(BigInt.fromI32(3))) {
    // update exit requests
    updateExitRequests(vault, timestamp)
  }

  if (vault.isGenesis) {
    if (isGnosisNetwork()) {
      if (newVersion.equals(BigInt.fromI32(4))) {
        const v2Pool = createOrLoadV2Pool()
        v2Pool.isDisconnected = true
        v2Pool.save()
      }
    } else if (newVersion.equals(BigInt.fromI32(5))) {
      const v2Pool = createOrLoadV2Pool()
      v2Pool.isDisconnected = true
      v2Pool.save()
    }
  }

  // Handle SubVaultsRegistry for meta vaults (v4+ on Gnosis, v6+ on mainnet/hoodi)
  if (isSubVaultsRegistrySupported(vault)) {
    const metaVaultContract = MetaVaultContract.bind(vaultAddress)
    const registryResult = metaVaultContract.try_subVaultsRegistry()
    if (!registryResult.reverted && !registryResult.value.equals(Address.zero())) {
      const registryAddress = registryResult.value
      vault.subVaultsRegistry = registryAddress

      // Create mapping from registry to meta vault
      const registryMap = new SubVaultsRegistryMap(registryAddress.toHex())
      registryMap.metaVault = vaultAddress
      registryMap.save()

      SubVaultsRegistryTemplate.create(registryAddress)

      log.info('[Vault] SubVaultsRegistry created vault={} registry={}', [
        vaultAddress.toHex(),
        registryAddress.toHex(),
      ])
    }
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Initialized vault={} version={}', [vaultAddress.toHex(), newVersion.toString()])
}

// Event emitted on CheckpointCreated event
export function handleCheckpointCreated(event: CheckpointCreated): void {
  const vaultAddress = event.address
  const vault = loadVault(vaultAddress)!
  if (vault.exitingAssets.equals(BigInt.zero()) || vault.version.lt(BigInt.fromI32(3))) {
    return
  }
  // the first checkpoint in version 3 processes all the v2 exit requests
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.save()

  log.info('[Vault] CheckpointCreated vault={}', [vaultAddress.toHex()])
}

// Event emitted on FeeSharesMinted event
export function handleFeeSharesMinted(event: FeeSharesMinted): void {
  const vaultAddress = event.address
  const mintedShares = event.params.shares

  const vault = loadVault(vaultAddress)!
  vault._unclaimedFeeRecipientShares = vault._unclaimedFeeRecipientShares.minus(mintedShares)
  if (vault._unclaimedFeeRecipientShares.lt(BigInt.zero())) {
    const feeRecipient = createOrLoadAllocator(Address.fromBytes(vault.feeRecipient), vaultAddress)
    // deduct the negative shares from fee recipient
    feeRecipient.shares = feeRecipient.shares.plus(vault._unclaimedFeeRecipientShares)
    feeRecipient.assets = convertSharesToAssets(vault, feeRecipient.shares)
    feeRecipient.save()
    log.warning(
      '[FeeSharesMinted] Negative unclaimed fee recipient shares after minting fee shares vault={}, feeRecipient={} diff={}',
      [vaultAddress.toHex(), vault.feeRecipient.toHex(), vault._unclaimedFeeRecipientShares.toString()],
    )
    vault._unclaimedFeeRecipientShares = BigInt.zero()
  } else if (!vault.canHarvest && vault._unclaimedFeeRecipientShares.gt(BigInt.zero())) {
    const feeRecipient = createOrLoadAllocator(Address.fromBytes(vault.feeRecipient), vaultAddress)
    // deduct the remaining unclaimed shares from fee recipient
    feeRecipient.shares = feeRecipient.shares.minus(vault._unclaimedFeeRecipientShares)
    feeRecipient.assets = convertSharesToAssets(vault, feeRecipient.shares)
    feeRecipient.save()
    log.warning(
      '[FeeSharesMinted] Non zero unclaimed fee recipient shares after minting fee shares vault={}, feeRecipient={} diff={}',
      [vaultAddress.toHex(), vault.feeRecipient.toHex(), vault._unclaimedFeeRecipientShares.toString()],
    )
    vault._unclaimedFeeRecipientShares = BigInt.zero()
  }
  vault.save()
  log.info('[Vault] FeeSharesMinted vault={}', [vaultAddress.toHex()])
}

// Event emitted on validator root and IPFS hash update (deprecated)
export function handleValidatorsRootUpdated(event: ValidatorsRootUpdated): void {
  const params = event.params

  const validatorsRoot = params.validatorsRoot

  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!

  vault.depositDataRoot = validatorsRoot

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] ValidatorsRootUpdated vault={} validatorsRoot={}', [vaultAddress.toHex(), validatorsRoot.toHex()])
}

// Event emitted on admin update
export function handleAdminUpdated(event: AdminUpdated): void {
  const params = event.params
  const newAdmin = params.newAdmin
  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!
  vault.admin = newAdmin
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] AdminUpdated vault={} newAdmin={}', [vaultAddress.toHex(), newAdmin.toHex()])
}

// Event emitted on fee percent update
export function handleFeePercentUpdated(event: FeePercentUpdated): void {
  const params = event.params
  const feePercent = params.feePercent
  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!
  vault.lastFeePercent = vault.feePercent
  vault.feePercent = feePercent
  vault.lastFeeUpdateTimestamp = event.block.timestamp
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] FeePercentUpdated vault={} feePercent={}', [vaultAddress.toHex(), feePercent.toString()])
}

// Event emitted on fee recipient update
export function handleFeeRecipientUpdated(event: FeeRecipientUpdated): void {
  const params = event.params

  const feeRecipient = params.feeRecipient

  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!

  vault.feeRecipient = feeRecipient

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] FeeRecipientUpdated vault={} feeRecipient={}', [vaultAddress.toHex(), feeRecipient.toHex()])
}

// Event emitted on keys manager update (deprecated)
export function handleKeysManagerUpdated(event: KeysManagerUpdated): void {
  const params = event.params

  const keysManager = params.keysManager

  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!

  vault.depositDataManager = keysManager

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] KeysManagerUpdated vault={} keysManager={}', [vaultAddress.toHex(), keysManager.toHex()])
}

// Event emitted on validators manager update
export function handleValidatorsManagerUpdated(event: ValidatorsManagerUpdated): void {
  const params = event.params

  const validatorsManager = params.validatorsManager

  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!

  vault.validatorsManager = validatorsManager

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] ValidatorsManagerUpdated vault={} validatorsManager={}', [
    vaultAddress.toHex(),
    validatorsManager.toHex(),
  ])
}

// Event emitted when an allocator enters the V1 exit queue. (deprecated)
// Shares locked, but assets can't be claimed until shares burned (on CheckpointCreated event)
export function handleV1ExitQueueEntered(event: V1ExitQueueEntered): void {
  const params = event.params

  const owner = params.owner
  const receiver = params.receiver
  const positionTicket = params.positionTicket
  const shares = params.shares
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const vault = loadVault(vaultAddress)!
  const assets = convertSharesToAssets(vault, shares)
  const timestamp = event.block.timestamp

  createAllocatorAction(event, event.address, AllocatorActionType.ExitQueueEntered, owner, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  vault.queuedShares = vault.queuedShares.plus(shares)
  vault.save()

  // Create exit request
  const exitRequestId = `${vaultAddressHex}-${positionTicket.toString()}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddressHex
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.allocator = getAllocatorId(owner, vaultAddress)
  exitRequest.totalTickets = shares
  exitRequest.totalAssets = assets
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.isV2Position = false
  exitRequest.exitQueueIndex = null
  exitRequest.timestamp = timestamp
  exitRequest.isClaimable = false
  exitRequest.isClaimed = false
  exitRequest.save()

  const aave = loadAave()!
  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const allocator = loadAllocator(owner, event.address)!

  // if it's ERC-20 vault shares are updated in Transfer event handler
  if (!vault.isErc20) {
    decreaseAllocatorShares(osToken, osTokenConfig, vault, allocator, shares)
  }

  allocator.exitingAssets = allocator.exitingAssets.plus(assets)
  allocator.stakingExitingAssets = allocator.stakingExitingAssets.plus(assets)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  log.info('[Vault] V1ExitQueueEntered vault={} owner={} shares={}', [
    vaultAddressHex,
    owner.toHex(),
    shares.toString(),
  ])
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
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const timestamp = event.block.timestamp

  // Update vault shares and assets
  const vault = loadVault(vaultAddress)!
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
  vault.save()

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.minus(assets)
  network.save()

  createAllocatorAction(event, vaultAddress, AllocatorActionType.ExitQueueEntered, owner, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  // Create exit request
  const exitRequestId = `${vaultAddressHex}-${positionTicket.toString()}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddressHex
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.allocator = getAllocatorId(owner, vaultAddress)
  exitRequest.totalTickets = exitingTickets
  exitRequest.totalAssets = assets
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.isV2Position = true
  exitRequest.exitQueueIndex = null
  exitRequest.timestamp = timestamp
  exitRequest.isClaimable = false
  exitRequest.isClaimed = false
  exitRequest.save()

  // Update allocator shares
  const aave = loadAave()!
  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const allocator = loadAllocator(owner, vaultAddress)!
  decreaseAllocatorShares(osToken, osTokenConfig, vault, allocator, shares)
  allocator.exitingAssets = allocator.exitingAssets.plus(assets)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  log.info('[Vault] V2ExitQueueEntered vault={} owner={} shares={} assets={}', [
    vaultAddressHex,
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
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()

  createAllocatorAction(event, event.address, AllocatorActionType.ExitedAssetsClaimed, receiver, claimedAssets, null)

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequest = loadExitRequest(vaultAddress, prevPositionTicket)!

  let claimedTickets: BigInt
  const isExitQueueRequestResolved = newPositionTicket.equals(BigInt.zero())
  if (isExitQueueRequestResolved) {
    claimedTickets = prevExitRequest.totalTickets
  } else {
    claimedTickets = newPositionTicket.minus(prevPositionTicket)
  }

  if (prevExitRequest.isV2Position) {
    // Update vault shares and assets
    const vault = loadVault(vaultAddress)!
    vault.exitingAssets = vault.exitingAssets.minus(claimedAssets)
    vault.exitingTickets = vault.exitingTickets.minus(claimedTickets)
    vault.save()
  }

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddressHex}-${newPositionTicket.toString()}`
    const nextExitRequest = new ExitRequest(nextExitQueueRequestId)
    nextExitRequest.vault = vaultAddressHex
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.timestamp = prevExitRequest.timestamp
    nextExitRequest.allocator = prevExitRequest.allocator
    nextExitRequest.receiver = receiver
    nextExitRequest.positionTicket = newPositionTicket
    nextExitRequest.isV2Position = prevExitRequest.isV2Position
    nextExitRequest.totalTickets = prevExitRequest.totalTickets.minus(claimedTickets)
    nextExitRequest.totalAssets = prevExitRequest.totalAssets.minus(claimedAssets)
    nextExitRequest.exitedAssets = BigInt.zero()
    nextExitRequest.exitQueueIndex = null
    nextExitRequest.isClaimable = false
    nextExitRequest.isClaimed = false
    nextExitRequest.save()
  }

  prevExitRequest.isClaimable = false
  prevExitRequest.isClaimed = true
  prevExitRequest.save()

  // update allocator APY
  const aave = loadAave()!
  const vault = loadVault(vaultAddress)!
  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const allocator = loadAllocator(Address.fromBytes(prevExitRequest.owner), vaultAddress)!
  allocator.exitingAssets = allocator.exitingAssets.minus(claimedAssets)
  if (allocator.exitingAssets.lt(BigInt.zero())) {
    log.warning('[Vault] Exiting assets for allocator {} in vault {} is negative after claim', [
      allocator.address.toHex(),
      vaultAddressHex,
    ])
    allocator.exitingAssets = BigInt.zero()
  }

  // Update stakingExitingAssets for V1 positions
  if (!prevExitRequest.isV2Position) {
    const prevStakingExitingAssetsDelta = prevExitRequest.totalAssets.minus(prevExitRequest.exitedAssets)
    allocator.stakingExitingAssets = allocator.stakingExitingAssets.minus(prevStakingExitingAssetsDelta)
  }

  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  log.info('[Vault] ExitedAssetsClaimed vault={} prevPositionTicket={} newPositionTicket={} claimedAssets={}', [
    vaultAddressHex,
    prevPositionTicket.toString(),
    newPositionTicket.toString(),
    claimedAssets.toString(),
  ])
}

export function handleOsTokenMinted(event: OsTokenMinted): void {
  const holder = event.params.caller
  const shares = event.params.shares
  const assets = event.params.assets
  const vaultAddress = event.address

  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.plus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.save()

  const vault = loadVault(vaultAddress)!
  let allocator: Allocator
  if (vault.isGenesis) {
    // the allocator may not exist during Genesis Vault migration
    allocator = createOrLoadAllocator(holder, vaultAddress)
  } else {
    allocator = loadAllocator(holder, vaultAddress)!
  }
  const aave = loadAave()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  increaseAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, shares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  createAllocatorAction(event, vaultAddress, AllocatorActionType.OsTokenMinted, holder, assets, shares)
  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[Vault] OsTokenMinted vault={} holder={} shares={}', [
    vaultAddress.toHex(),
    holder.toHex(),
    shares.toString(),
  ])
}

export function handleOsTokenBurned(event: OsTokenBurned): void {
  const holder = event.params.caller
  const assets = event.params.assets
  const shares = event.params.shares
  const vaultAddress = event.address

  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()

  const aave = loadAave()!
  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const allocator = loadAllocator(holder, vaultAddress)!
  decreaseAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, shares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, vaultAddress, AllocatorActionType.OsTokenBurned, holder, assets, shares)

  log.info('[Vault] OsTokenBurned vault={} holder={} shares={}', [
    vaultAddress.toHex(),
    holder.toHex(),
    shares.toString(),
  ])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.receivedAssets
  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.save()

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.minus(withdrawnAssets)
  network.save()

  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()

  const aave = loadAave()!
  const allocator = loadAllocator(holder, vaultAddress)!
  decreaseAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, shares)
  decreaseAllocatorShares(osToken, osTokenConfig, vault, allocator, withdrawnShares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, AllocatorActionType.OsTokenLiquidated, holder, null, shares)
  log.info('[Vault] OsTokenLiquidated vault={} holder={} shares={}', [
    vaultAddress.toHex(),
    holder.toHex(),
    shares.toString(),
  ])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const holder = event.params.user
  const shares = event.params.osTokenShares
  const withdrawnShares = event.params.shares
  const withdrawnAssets = event.params.assets
  const vaultAddress = event.address

  const vault = loadVault(vaultAddress)!
  vault.totalShares = vault.totalShares.minus(withdrawnShares)
  vault.totalAssets = vault.totalAssets.minus(withdrawnAssets)
  vault.save()

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.minus(withdrawnAssets)
  network.save()

  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  osToken.totalAssets = osToken.totalAssets.minus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.minus(shares)
  osToken.save()

  const aave = loadAave()!
  const allocator = loadAllocator(holder, vaultAddress)!
  decreaseAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, shares)
  decreaseAllocatorShares(osToken, osTokenConfig, vault, allocator, withdrawnShares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  createAllocatorAction(event, event.address, AllocatorActionType.OsTokenRedeemed, holder, null, shares)

  log.info('[Vault] OsTokenRedeemed vault={} holder={} shares={}', [
    vaultAddress.toHex(),
    holder.toHex(),
    shares.toString(),
  ])
}

// Event emitted when GenesisVault is initialized
export function handleGenesisVaultCreated(event: GenesisVaultCreated): void {
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()
  const params = event.params
  const capacity = params.capacity
  const feePercent = params.feePercent
  const admin = params.admin
  const metadataIpfsHash = event.params.metadataIpfsHash

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
  vault.isPrivate = false
  vault.isBlocklist = false
  vault.isErc20 = false
  vault.isMetaVault = false
  vault.isOsTokenEnabled = true
  vault.isCollateralized = true
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.baseApy = BigDecimal.zero()
  vault.extraApy = BigDecimal.zero()
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = true
  if (isGnosisNetwork()) {
    vault.version = BigInt.fromI32(2)
    vault.osTokenConfig = '2'
  } else {
    vault.version = BigInt.fromI32(1)
    vault.osTokenConfig = '1'
  }
  vault.metadataIpfsHash = metadataIpfsHash
  vault._periodEarnedAssets = BigInt.zero()
  vault._unclaimedFeeRecipientShares = BigInt.zero()
  vault._prevAllocatorAssets = BigInt.fromString(WAD)

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = loadNetwork()!
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
  const metadataIpfsHash = params.metadataIpfsHash

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
  vault.isPrivate = false
  vault.isBlocklist = true
  vault.isErc20 = false
  vault.isMetaVault = false
  vault.isOsTokenEnabled = false
  vault.isCollateralized = false
  vault.mevEscrow = ownMevEscrow
  vault.addressString = vaultAddressHex
  vault.createdAt = event.block.timestamp
  vault.baseApy = BigDecimal.zero()
  vault.extraApy = BigDecimal.zero()
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.isGenesis = false
  vault.blocklistManager = admin
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.version = BigInt.fromI32(1)
  vault.osTokenConfig = '1'
  vault.metadataIpfsHash = metadataIpfsHash
  vault._periodEarnedAssets = BigInt.zero()
  vault._unclaimedFeeRecipientShares = BigInt.zero()
  vault._prevAllocatorAssets = BigInt.fromString(WAD)

  vault.save()
  VaultTemplate.create(vaultAddress)
  OwnMevEscrowTemplate.create(ownMevEscrow)
  BlocklistVaultTemplate.create(vaultAddress)

  const network = loadNetwork()!
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

  const vault = loadVault(vaultAddress)!
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.plus(assets)
  network.save()

  const aave = loadAave()!
  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const allocator = createOrLoadAllocator(receiver, vaultAddress)
  increaseAllocatorShares(osToken, osTokenConfig, vault, allocator, shares)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator)
  allocator.save()

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

export function handleAssetsDonated(event: AssetsDonated): void {
  const sender = event.params.sender
  const assets = event.params.assets
  const vaultAddress = event.address
  const vaultAddressHex = vaultAddress.toHex()

  const xdaiConverter = loadXdaiConverter(vaultAddress)
  if (xdaiConverter && Address.fromBytes(xdaiConverter.address).equals(sender)) {
    xdaiConverter.totalHarvestedAssets = xdaiConverter.totalHarvestedAssets.plus(assets)
    xdaiConverter.save()
    log.info('[Vault] AssetsDonated from xDaiConverter vault={} assets={}', [vaultAddressHex, assets.toString()])
    return
  }

  const vault = loadVault(vaultAddress)!

  // Skip for v1 meta vaults as they contain donated assets in harvested event
  if (vault.isMetaVault && !isSubVaultsRegistrySupported(vault)) {
    log.info('[Vault] AssetsDonated skipped for MetaVault v1 vault={} assets={}', [vaultAddressHex, assets.toString()])
    return
  }

  vault._periodEarnedAssets = vault._periodEarnedAssets.plus(assets)
  vault.save()
  log.info('[Vault] AssetsDonated vault={} assets={}', [vaultAddressHex, assets.toString()])
}

export function syncVaults(block: ethereum.Block): void {
  const osToken = loadOsToken()
  const network = loadNetwork()
  if (!network || !osToken) {
    log.warning('[SyncVaults] OsToken or Network not found', [])
    return
  }

  const newTimestamp = block.timestamp
  const vaultsCheckpoint = createOrLoadCheckpoint(CheckpointType.VAULTS)
  const keeperCheckpoint = createOrLoadCheckpoint(CheckpointType.KEEPER)
  const isKeeperUpdated = vaultsCheckpoint.timestamp.lt(keeperCheckpoint.timestamp)

  if (!isKeeperUpdated && vaultsCheckpoint.timestamp.plus(BigInt.fromI32(3600)).gt(newTimestamp)) {
    // update claimable exit requests once in an hour if there are no rewards updates
    return
  }

  let vaultAddress: Address
  let vault: Vault
  const vaultIds = network.vaultIds
  const totalVaults = vaultIds.length
  for (let i = 0; i < totalVaults; i++) {
    vaultAddress = Address.fromString(vaultIds[i])
    vault = loadVault(vaultAddress)!
    if (!vault.isCollateralized) {
      continue
    }

    if (!isKeeperUpdated || vault.isMetaVault) {
      // only update timestamps of exit requests in case the keeper has not been updated or vault is a MetaVault
      updateClaimableExitRequests(vault, newTimestamp)
      continue
    }

    // update vault allocators, exit requests, reward splitters
    syncVault(osToken, vault, newTimestamp)
  }

  vaultsCheckpoint.timestamp = newTimestamp
  vaultsCheckpoint.save()

  log.info('[SyncVaults] Vaults synced totalVaults={} timestamp={} assetsUpdated={}', [
    totalVaults.toString(),
    newTimestamp.toString(),
    isKeeperUpdated.toString(),
  ])
}
