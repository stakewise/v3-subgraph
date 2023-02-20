import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'

import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { MevEscrow, Vault } from '../../generated/schema'
import { Vault as VaultTemplate, PrivateVault as PrivateVaultTemplate } from '../../generated/templates'
import { createTransaction } from '../entities/transaction'
import { createOrLoadNetwork } from '../entities/network'


// Event emitted on vault create
export function handleVaultCreated(event: VaultCreated): void {
  const block = event.block
  const params = event.params
  const vaultAddress = params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1

  const mevEscrow = new MevEscrow(params.mevEscrow.toHex())
  mevEscrow.vault = vaultAddressHex

  const vault = new Vault(vaultAddressHex)

  // These properties are empty on vault creation
  // they will be updated on future vault events
  vault.imageUrl = null
  vault.displayName = null
  vault.description = null
  vault.validatorsRoot = null
  vault.metadataIpfsHash = null
  vault.score = BigDecimal.fromString('10')
  vault.totalShares = BigInt.fromI32(0)
  vault.totalAssets = BigInt.fromI32(0)
  vault.queuedShares = BigInt.fromI32(0)
  vault.unclaimedAssets = BigInt.fromI32(0)
  vault.executionReward = BigInt.fromI32(0)
  vault.consensusReward = BigInt.fromI32(0)
  vault.avgRewardPerAsset = BigInt.fromI32(0)

  // Properties from event params
  vault.admin = params.admin
  vault.capacity = params.capacity
  vault.tokenName = params.name
  vault.isPrivate = params.isPrivate
  vault.feePercent = params.feePercent
  vault.tokenSymbol = params.symbol
  vault.feeRecipient = params.admin
  vault.operator = params.admin
  vault.factory = event.address
  vault.createdAt = block.timestamp
  vault.addressString = vaultAddressHex

  if (vault.isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = params.admin
  }

  vault.save()
  network.save()
  mevEscrow.save()

  createTransaction(event.transaction.hash.toHex(), event.transactionLogIndex)

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
