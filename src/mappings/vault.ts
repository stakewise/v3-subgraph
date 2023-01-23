import { Address, BigInt, ipfs, log, store, json, ethereum } from '@graphprotocol/graph-ts'

import { AllocatorAction, Vault, ExitRequest, MevEscrow } from '../../generated/schema'
import {
  Deposit,
  Withdraw,
  Transfer,
  StateUpdated,
  MetadataUpdated,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated,
} from '../../generated/templates/Vault/Vault'
import { Multicall } from '../../generated/templates/Vault/Multicall'

import { updateMetadata } from '../entities/metadata'
import { createOrLoadAllocator } from '../entities/allocator'
import { createOrLoadDaySnapshot, getRewardPerAsset, loadDaySnapshot } from '../entities/daySnapshot'
import { DAY } from '../helpers/constants'


const ADDRESS_ZERO = Address.zero()
const snapshotsCount = 10

function updateAvgRewardPerAsset(timestamp: BigInt, vault: Vault): void {
  let avgRewardPerAsset = BigInt.fromI32(0)
  let snapshotsCountBigInt = BigInt.fromI32(snapshotsCount)

  for (let i = 1; i <= snapshotsCount; i++) {
    const diff = DAY.times(BigInt.fromI32(i))
    const daySnapshot = loadDaySnapshot(timestamp.minus(diff), vault.id)

    if (daySnapshot) {
      avgRewardPerAsset = avgRewardPerAsset.plus(daySnapshot.rewardPerAsset)
    }
    else {
      snapshotsCountBigInt = snapshotsCountBigInt.minus(BigInt.fromI32(1))
    }
  }

  avgRewardPerAsset = avgRewardPerAsset.div(snapshotsCountBigInt)

  vault.avgRewardPerAsset = avgRewardPerAsset
  vault.save()
}

export function handleBlock(block: ethereum.Block): void {
  const mevEscrowAddress = block.author.toHex()
  const mevEscrow = MevEscrow.load(mevEscrowAddress)

  if (mevEscrow) {
    // TODO get address from env or config
    const multicallContract = Multicall.bind(Address.fromString('0x77dCa2C955b15e9dE4dbBCf1246B4B85b651e50e'))
    const mevEscrowBalance = multicallContract.getEthBalance(block.author)

    const vaultAddress = mevEscrow.vault
    const vault = Vault.load(vaultAddress) as Vault
    const reward = mevEscrowBalance.minus(vault.executionReward)

    const daySnapshot = createOrLoadDaySnapshot(block.timestamp, vaultAddress)
    const rewardPerAsset = getRewardPerAsset(reward, vault.feePercent, daySnapshot.principalAssets)

    daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
    daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)

    daySnapshot.save()

    vault.executionReward = vault.executionReward.plus(reward)
    vault.totalAssets = vault.totalAssets.plus(reward)
    updateAvgRewardPerAsset(block.timestamp, vault)

    vault.save()

    log.info(
      '[Vault] Block timestamp={}',
      [
        block.timestamp.toString(),
      ]
    )
  }
}

// Event emitted on assets transfer from allocator to vault
export function handleDeposit(event: Deposit): void {
  const params = event.params
  const assets = params.assets
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHex()) as Vault

  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.save()

  const allocatorAction = new AllocatorAction(`${event.transaction.hash}-${event.transactionLogIndex}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = params.caller
  allocatorAction.actionType = 'Deposit'
  allocatorAction.assets = assets
  allocatorAction.shares = params.shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault.id)

  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(assets)
  daySnapshot.principalAssets = daySnapshot.principalAssets.plus(assets)
  daySnapshot.save()

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

  const allocatorAction = new AllocatorAction(`${event.transaction.hash}-${event.transactionLogIndex}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = params.caller
  allocatorAction.actionType = 'Withdraw'
  allocatorAction.assets = assets
  allocatorAction.shares = params.shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault.id)

  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(assets)
  daySnapshot.principalAssets = daySnapshot.principalAssets.minus(assets)
  daySnapshot.save()

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
  vault.executionReward = BigInt.fromI32(0)
  vault.consensusReward = BigInt.fromI32(0)
  vault.save()

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault.id)

  daySnapshot.principalAssets = vault.totalAssets
  daySnapshot.save()

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

  const allocatorAction = new AllocatorAction(`${event.transaction.hash}-${event.transactionLogIndex}`)

  allocatorAction.vault = vault.id
  allocatorAction.address = params.caller
  allocatorAction.actionType = 'ExitQueueEntered'
  allocatorAction.assets = null
  allocatorAction.shares = params.shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  // Create exit request
  const exitRequestId = `${vaultAddress}-${exitQueueId}`
  const exitRequest = new ExitRequest(exitRequestId)

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
  const allocatorAction = new AllocatorAction(`${event.transaction.hash}-${event.transactionLogIndex}`)

  vault.unclaimedAssets = vault.unclaimedAssets.minus(withdrawnAssets)
  vault.save()

  allocatorAction.vault = vault.id
  allocatorAction.address = params.caller
  allocatorAction.actionType = 'ExitedAssetsClaimed'
  allocatorAction.assets = withdrawnAssets
  allocatorAction.shares = null
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  const prevExitRequestId = `${vaultAddress}-${prevExitQueueId}`
  const prevExitRequest = ExitRequest.load(prevExitRequestId) as ExitRequest

  const isExitQueueRequestResolved = newExitQueueId.equals(BigInt.fromI32(0))

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
