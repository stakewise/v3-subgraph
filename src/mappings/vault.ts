import { Address, BigInt, ipfs, log, store, Value } from '@graphprotocol/graph-ts'

import { Vault, VaultExitRequest } from '../../generated/schema'
import {
  Transfer,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated, MetadataUpdated, Deposit, Withdraw, StateUpdated
} from '../../generated/templates/Vault/Vault'

import { createOrLoadAllocator } from '../entities/allocator'
import { updateMetadata } from '../entities/metadata'


const ADDRESS_ZERO = Address.zero()

// Event emitted on assets transfer from allocator to vault
export function handleDeposit(event: Deposit): void {
  const params = event.params
  const assets = params.assets
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  vault.totalAssets = vault.totalAssets.plus(assets)

  vault.save()

  log.info(
    '[Vault] Deposit vault={} assets={}',
    [
      vaultAddress.toHex(),
      assets.toString(),
    ]
  )
}

// Event emitted on assets withdraw from vault to allocator
export function handleWithdraw(event: Withdraw): void {
  const params = event.params
  const assets = params.assets
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  vault.totalAssets = vault.totalAssets.minus(assets)

  vault.save()

  log.info(
    '[Vault] Withdraw vault={} assets={}',
    [
      vaultAddress.toHex(),
      assets.toString(),
    ]
  )
}

// Event emitted on vault state update
export function handleStateUpdated(event: StateUpdated): void {
  const params = event.params
  const assetsDelta = params.assetsDelta
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  // assetsDelta can be a negative number
  vault.totalAssets = vault.totalAssets.plus(assetsDelta)

  vault.save()

  log.info(
    '[Vault] StateUpdated vault={} assetsDelta={}',
    [
      vaultAddress.toHex(),
      assetsDelta.toString(),
    ]
  )
}

// Event emitted on mint, burn or transfer shares between allocators
export function handleTransfer(event: Transfer): void {
  const params = event.params

  const from = params.from
  const to = params.to
  const value = params.value
  const vaultAddress = event.address

  const isMint = from.equals(ADDRESS_ZERO)
  const isBurn = to.equals(ADDRESS_ZERO)
  const isQueuedSharesBurn = isBurn && from.equals(vaultAddress)

  // Burn locked shares on allocator exit
  if (isQueuedSharesBurn) {
    const vault = Vault.load(vaultAddress.toHex()) as Vault

    vault.queuedShares = vault.queuedShares.minus(value)
    vault.save()
  }

  if (!isMint) {
    const allocatorFrom = createOrLoadAllocator(from, vaultAddress)

    allocatorFrom.shares = allocatorFrom.shares.minus(value)
    allocatorFrom.save()
  }

  if (!isBurn) {
    const allocatorTo = createOrLoadAllocator(to, vaultAddress)

    allocatorTo.shares = allocatorTo.shares.plus(value)
    allocatorTo.save()
  }

  log.info(
    '[Vault] Transfer vault={} from={} to={} value={}',
    [
      vaultAddress.toHex(),
      params.from.toHex(),
      params.to.toHex(),
      params.value.toString(),
    ]
  )
}

// Event emitted on metadata IPFS hash update
export function handleMetadataUpdated(event: MetadataUpdated): void {
  const params = event.params

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.metadataIpfsHash = params.metadataIpfsHash

  vault.save()

  // ipfs.mapJSON(params.metadataIpfsHash, 'updateMetadata', Value.fromString(vaultAddress))

  log.info(
    '[Vault] MetadataUpdated metadataIpfsHash={}',
    [
      params.metadataIpfsHash,
    ]
  )
}

// Event emitted on validators root and IPFS hash update
export function handleValidatorsRootUpdated(event: ValidatorsRootUpdated): void {
  const params = event.params

  const validatorsRoot = params.validatorsRoot
  const validatorsIpfsHash = params.validatorsIpfsHash

  const vault = Vault.load(event.address.toHex()) as Vault

  vault.validatorsRoot = validatorsRoot
  vault.validatorsIpfsHash = validatorsIpfsHash

  vault.save()

  log.info(
    '[Vault] ValidatorsRootUpdated validatorsRoot={} validatorsIpfsHash={}',
    [
      validatorsRoot.toHex(),
      validatorsIpfsHash,
    ]
  )
}

// Event emitted when an allocator enters the exit queue.
// Shares locked, but assets can't be claimed until shares burned (on CheckpointCreated event)
export function handleExitQueueEntered(event: ExitQueueEntered): void {
  const params = event.params

  const owner = params.owner
  const shares = params.shares
  const receiver = params.receiver
  const exitQueueId = params.exitQueueId
  const vaultAddress = event.address.toHex()

  // Update vault queued shares
  const vault = Vault.load(vaultAddress) as Vault

  vault.queuedShares = vault.queuedShares.plus(shares)
  vault.save()

  // Create exit request
  const exitRequestId = `${vaultAddress}-${exitQueueId}`
  const exitRequest = new VaultExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.exitQueueId = exitQueueId
  exitRequest.withdrawnShares = BigInt.fromI32(0)
  exitRequest.withdrawnAssets = BigInt.fromI32(0)

  exitRequest.save()

  log.info(
    '[Vault] ExitQueueEntered vault={} shares={} exitQueueId={}',
    [
      vaultAddress,
      shares.toString(),
      exitQueueId.toString(),
    ]
  )
}

// Event emitted when an allocator claim assets partially or completely.
// If assets are claimed completely ExitQueueRequest will be deleted
export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const params = event.params

  const receiver = params.receiver
  const prevExitQueueId = params.prevExitQueueId
  const newExitQueueId = params.newExitQueueId
  const withdrawnAssets = params.withdrawnAssets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.unclaimedAssets = vault.unclaimedAssets.minus(withdrawnAssets)

  vault.save()

  const prevVaultExitRequestId = `${vaultAddress}-${prevExitQueueId}`
  const prevVaultExitRequest = VaultExitRequest.load(prevVaultExitRequestId) as VaultExitRequest

  const isExitQueueRequestResolved = newExitQueueId.equals(BigInt.fromI32(0))

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddress}-${newExitQueueId}`
    const withdrawnShares = newExitQueueId.minus(prevExitQueueId)
    const nextVaultExitRequest = new VaultExitRequest(nextExitQueueRequestId)

    nextVaultExitRequest.vault = vaultAddress
    nextVaultExitRequest.owner = prevVaultExitRequest.owner
    nextVaultExitRequest.receiver = receiver
    nextVaultExitRequest.exitQueueId = newExitQueueId
    nextVaultExitRequest.totalShares = prevVaultExitRequest.totalShares
    nextVaultExitRequest.withdrawnShares = prevVaultExitRequest.withdrawnShares.plus(withdrawnShares)
    nextVaultExitRequest.withdrawnAssets = prevVaultExitRequest.withdrawnAssets.plus(withdrawnAssets)

    nextVaultExitRequest.save()
  }

  store.remove('VaultExitRequest', prevVaultExitRequestId)

  log.info(
    '[Vault] ExitedAssetsClaimed vault={} withdrawnAssets={} newExitQueueId={} queuedShares={} unclaimedAssets={}',
    [
      vaultAddress,
      withdrawnAssets.toString(),
      newExitQueueId.toString(),
      vault.queuedShares.toString(),
      vault.unclaimedAssets.toString(),
    ]
  )
}
