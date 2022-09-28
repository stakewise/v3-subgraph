import { Address, BigInt, log, store } from '@graphprotocol/graph-ts'

import { Vault, VaultExitRequest } from '../../generated/schema'
import {
  Transfer,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated
} from '../../generated/templates/Vault/Vault'

import { createOrLoadStaker } from '../entities/staker'


const ADDRESS_ZERO = Address.zero()

// Event emitted on mint, burn or transfer shares between stakers
const handleVaultTransfer = (event: Transfer): void => {
  const params = event.params

  const from = params.from
  const to = params.to
  const value = params.value
  const vaultAddress = event.address

  const isMint = from.equals(ADDRESS_ZERO)
  const isBurn = to.equals(ADDRESS_ZERO)
  const isQueuedSharesBurn = isBurn && from.equals(vaultAddress)

  // Burn locked shares on staker exit
  if (isQueuedSharesBurn) {
    const vault = Vault.load(vaultAddress.toHex()) as Vault

    vault.queuedShares = vault.queuedShares.minus(value)
    vault.save()
  }

  if (!isMint) {
    const stakerFrom = createOrLoadStaker(from, vaultAddress)

    stakerFrom.shares = stakerFrom.shares.minus(value)
    stakerFrom.save()
  }

  if (!isBurn) {
    const stakerTo = createOrLoadStaker(to, vaultAddress)

    stakerTo.shares = stakerTo.shares.plus(value)
    stakerTo.save()
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

// Event emitted on validators root and IPFS hash update
const handleValidatorsRootUpdated = (event: ValidatorsRootUpdated): void => {
  const params = event.params

  const validatorsRoot = params.newValidatorsRoot
  const validatorsIpfsHash = params.newValidatorsIpfsHash

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

// Event emitted when a staker enters the exit queue.
// Shares locked, but assets can't be claimed until shares burned (on CheckpointCreated event)
const handleExitQueueEntered = (event: ExitQueueEntered): void => {
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

// Event emitted when a staker claim assets partially or completely.
// If assets are claimed completely ExitQueueRequest will be deleted
const handleExitedAssetsClaimed = (event: ExitedAssetsClaimed): void => {
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


export {
  handleVaultTransfer,
  handleExitQueueEntered,
  handleExitedAssetsClaimed,
  handleValidatorsRootUpdated,
}
