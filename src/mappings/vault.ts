import { Address, BigInt, ipfs, log, store, json } from '@graphprotocol/graph-ts'

import { AllocatorAction, Vault, ExitRequest } from '../../generated/schema'
import {
  Deposit,
  Redeem,
  CheckpointCreated,
  OperatorUpdated,
  MetadataUpdated,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated,
  FeeRecipientUpdated,
  Transfer
} from '../../generated/templates/Vault/Vault'

import { updateMetadata } from '../entities/metadata'
import { createTransaction } from '../entities/transaction'
import { createOrLoadAllocator } from '../entities/allocator'
import { createOrLoadDaySnapshot} from '../entities/daySnapshot'


// Event emitted on assets transfer from allocator to vault
export function handleDeposit(event: Deposit): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.totalShares = vault.totalShares.plus(shares)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(
    `${txHash}-${event.transactionLogIndex.toString()}`
  )

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = params.caller == Address.fromBytes(vault.factory) ? 'VaultCreation' : 'Deposit'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(txHash)

  log.info(
    '[Vault] Deposit vault={} assets={}',
    [
      vaultAddress.toHex(),
      assets.toString(),
    ]
  )
}

// Event emitted on assets withdraw from vault to allocator
export function handleRedeem(event: Redeem): void {
  const params = event.params
  const assets = params.assets
  const shares = params.shares
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)

  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.minus(assets)
  vault.principalAssets = vault.principalAssets.minus(assets)
  vault.totalShares = vault.totalShares.minus(shares)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(
    `${txHash}-${event.transactionLogIndex.toString()}`
  )

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'Redeem'
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(txHash)

  log.info(
    '[Vault] Redeem vault={} assets={}',
    [
      vaultAddress.toHex(),
      assets.toString(),
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

  const zeroAddress = Address.zero()
  const isMint = from.equals(zeroAddress)
  const isBurn = to.equals(zeroAddress)

  if (!isMint) {
    const allocatorFrom = createOrLoadAllocator(from, vaultAddress)

    allocatorFrom.shares = allocatorFrom.shares.minus(value)
    allocatorFrom.save()

    if (isBurn && allocatorFrom.shares.isZero()) {
      store.remove('Allocator', allocatorFrom.id)
    }
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

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.validatorsRoot = validatorsRoot

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info(
    '[Vault] ValidatorsRootUpdated vault={} validatorsRoot={}',
    [
      vaultAddress,
      validatorsRoot.toHex(),
    ]
  )
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

  log.info(
    '[Vault] FeeRecipientUpdated vault={} feeRecipient={}',
    [
      vaultAddress,
      feeRecipient.toHex(),
    ]
  )
}

// Event emitted on operator update
export function handleOperatorUpdated(event: OperatorUpdated): void {
  const params = event.params

  const operator = params.operator

  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  vault.operator = operator

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info(
    '[Vault] OperatorUpdated vault={} operator={}',
    [
      vaultAddress,
      operator.toHex(),
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
  const positionCounter = params.positionCounter
  const vaultAddress = event.address.toHex()

  // Update vault queued shares
  const vault = Vault.load(vaultAddress) as Vault

  vault.queuedShares = vault.queuedShares.plus(shares)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(
    `${txHash}-${event.transactionLogIndex.toString()}`
  )

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'ExitQueueEntered'
  allocatorAction.assets = null
  allocatorAction.shares = params.shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(event.transaction.hash.toHex())

  // Create exit request
  const exitRequestId = `${vaultAddress}-${positionCounter}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.positionCounter = positionCounter
  exitRequest.save()

  log.info(
    '[Vault] ExitQueueEntered vault={} owner={} shares={}',
    [
      vaultAddress,
      owner.toHex(),
      shares.toString(),
    ]
  )
}

// Event emitted when an allocator claim assets partially or completely.
// If assets are claimed completely ExitQueueRequest will be deleted
export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const params = event.params

  const receiver = params.receiver
  const prevPositionCounter = params.prevPositionCounter
  const newPositionCounter = params.newPositionCounter
  const withdrawnAssets = params.withdrawnAssets
  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.unclaimedAssets = vault.unclaimedAssets.minus(withdrawnAssets)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(
    `${txHash}-${event.transactionLogIndex.toString()}`
  )

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'ExitedAssetsClaimed'
  allocatorAction.assets = withdrawnAssets
  allocatorAction.shares = null
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequestId = `${vaultAddress}-${prevPositionCounter}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  const isExitQueueRequestResolved = newPositionCounter.equals(BigInt.zero())

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddress}-${newPositionCounter}`
    const withdrawnShares = newPositionCounter.minus(prevPositionCounter)
    const totalShares = prevExitRequest.totalShares.minus(withdrawnShares)

    const nextExitRequest = new ExitRequest(nextExitQueueRequestId)

    nextExitRequest.vault = vaultAddress
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.receiver = receiver
    nextExitRequest.positionCounter = newPositionCounter
    nextExitRequest.totalShares = totalShares
    nextExitRequest.save()
  }

  store.remove('ExitRequest', prevExitRequestId)

  log.info(
    '[Vault] ExitedAssetsClaimed vault={} withdrawnAssets={}',
    [
      vaultAddress,
      withdrawnAssets.toString()
    ]
  )
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

  log.info(
    '[Vault] CheckpointCreated burnedShares={} exitedAssets={}',
    [
      burnedShares.toString(),
      exitedAssets.toString(),
    ]
  )
}
