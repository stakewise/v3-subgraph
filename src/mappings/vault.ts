import { Address, BigInt, ipfs, log, store, json } from '@graphprotocol/graph-ts'

import { AllocatorAction, Vault, ExitRequest } from '../../generated/schema'
import {
  Deposit,
  Withdraw,
  Transfer,
  StateUpdated,
  OperatorUpdated,
  MetadataUpdated,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated,
  FeeRecipientUpdated
} from '../../generated/templates/Vault/Vault'

import { updateMetadata } from '../entities/metadata'
import { createTransaction } from '../entities/transaction'
import { createOrLoadAllocator } from '../entities/allocator'
import { createOrLoadDaySnapshot} from '../entities/daySnapshot'


const ADDRESS_ZERO = Address.zero()

// Event emitted on assets transfer from allocator to vault
export function handleDeposit(event: Deposit): void {
  const params = event.params
  const assets = params.assets
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(assets)
  daySnapshot.principalAssets = daySnapshot.principalAssets.plus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  if (params.caller != Address.fromBytes(vault.factory)) {
    const allocatorAction = new AllocatorAction(
        `${txHash}-${event.transactionLogIndex.toString()}`
    )

    allocatorAction.vault = vault.id
    allocatorAction.address = event.transaction.from
    allocatorAction.actionType = 'Deposit'
    allocatorAction.assets = assets
    allocatorAction.shares = params.shares
    allocatorAction.createdAt = event.block.timestamp
    allocatorAction.save()
  }

  createTransaction(txHash, event.transactionLogIndex)

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

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)

  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(assets)
  daySnapshot.principalAssets = daySnapshot.principalAssets.minus(assets)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.minus(assets)
  vault.save()

  const txHash = event.transaction.hash.toHex()

  const allocatorAction = new AllocatorAction(
    `${txHash}-${event.transactionLogIndex.toString()}`
  )

  allocatorAction.vault = vault.id
  allocatorAction.address = event.transaction.from
  allocatorAction.actionType = 'Withdraw'
  allocatorAction.assets = assets
  allocatorAction.shares = params.shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  createTransaction(txHash, event.transactionLogIndex)

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

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)

  daySnapshot.principalAssets = vault.totalAssets
  daySnapshot.save()

  vault.executionReward = BigInt.zero()
  vault.consensusReward = BigInt.zero()
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

  const data = ipfs.cat(params.metadataIpfsHash)

  if (data) {
    const parsedJson = json.try_fromBytes(data)

    if (parsedJson.isOk && !parsedJson.isError) {
      updateMetadata(parsedJson.value, vault)
    }
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

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

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

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

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

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

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

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
  const exitQueueId = params.exitQueueId
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

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

  // Create exit request
  const exitRequestId = `${vaultAddress}-${exitQueueId}`
  const exitRequest = new ExitRequest(exitRequestId)

  exitRequest.vault = vaultAddress
  exitRequest.owner = owner
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.exitQueueId = exitQueueId
  exitRequest.withdrawnShares = BigInt.zero()
  exitRequest.withdrawnAssets = BigInt.zero()
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

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

  const prevExitRequestId = `${vaultAddress}-${prevExitQueueId}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  const isExitQueueRequestResolved = newExitQueueId.equals(BigInt.zero())

  if (!isExitQueueRequestResolved) {
    const nextExitQueueRequestId = `${vaultAddress}-${newExitQueueId}`
    const withdrawnShares = newExitQueueId.minus(prevExitQueueId)
    const nextExitRequest = new ExitRequest(nextExitQueueRequestId)

    nextExitRequest.vault = vaultAddress
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.receiver = receiver
    nextExitRequest.exitQueueId = newExitQueueId
    nextExitRequest.totalShares = prevExitRequest.totalShares
    nextExitRequest.withdrawnShares = prevExitRequest.withdrawnShares.plus(withdrawnShares)
    nextExitRequest.withdrawnAssets = prevExitRequest.withdrawnAssets.plus(withdrawnAssets)

    nextExitRequest.save()
  }

  store.remove('ExitRequest', prevExitRequestId)

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
