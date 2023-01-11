import { BigInt, log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { Vault as VaultTemplate } from '../../generated/templates'
import { createOrLoadNetwork } from '../entities/network'


// Event emitted on vault create
export function handleVaultCreated(event: VaultCreated): void {
  const block = event.block
  const params = event.params
  const vaultAddress = params.vault

  const vault = new Vault(vaultAddress.toHex())
  const network = createOrLoadNetwork()

  network.vaultsTotal = network.vaultsTotal + 1

  // These properties are empty on vault creating
  // they will be updated on future vault events
  vault.imageUrl = null
  vault.displayName = null
  vault.description = null
  vault.validatorsRoot = null
  vault.metadataIpfsHash = null
  vault.validatorsIpfsHash = null
  // vault.allocators = []
  // vault.checkpoints = []
  // vault.daySnapshots = []
  // vault.exitRequests = []
  // vault.allocatorActions = []
  vault.rewardAsset = BigInt.fromI32(0)
  vault.totalShares = BigInt.fromI32(0)
  vault.totalAssets = BigInt.fromI32(0)
  vault.queuedShares = BigInt.fromI32(0)
  vault.unclaimedAssets = BigInt.fromI32(0)
  vault.executionReward = BigInt.fromI32(0)
  vault.consensusReward = BigInt.fromI32(0)

  // Properties from event params
  vault.admin = params.admin
  vault.capacity = params.capacity
  vault.tokenName = params.name
  vault.mevEscrow = params.mevEscrow
  vault.feePercent = params.feePercent
  vault.tokenSymbol = params.symbol
  vault.feeRecipient = params.admin
  vault.factory = event.address
  vault.createdAt = block.timestamp

  vault.save()
  network.save()

  VaultTemplate.create(vaultAddress)

  log.info(
    '[VaultFactory] VaultCreated address={} admin={} mevEscrow={} feePercent={} capacity={}',
    [
      params.vault.toHex(),
      params.admin.toHex(),
      params.mevEscrow.toHex(),
      params.feePercent.toString(),
      params.capacity.toString(),
    ]
  )
}
