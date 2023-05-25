import { BigDecimal, BigInt, Address, log } from '@graphprotocol/graph-ts'

import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { Vault } from '../../generated/schema'
import { Vault as VaultTemplate, PrivateVault as PrivateVaultTemplate } from '../../generated/templates'
import { createTransaction } from '../entities/transaction'
import { createOrLoadNetwork } from '../entities/network'


// Event emitted on vault create
export function handleVaultCreated(event: VaultCreated): void {
  const block = event.block
  const params = event.params
  const vaultAddress = params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const vault = new Vault(vaultAddressHex)

  vault.tokenName = params.name
  vault.tokenSymbol = params.symbol
  vault.factory = event.address
  vault.admin = params.admin
  vault.capacity = params.capacity
  vault.feePercent = params.feePercent
  vault.feeRecipient = params.admin
  vault.operator = params.admin
  vault.avgRewardPerAsset = BigDecimal.zero()
  vault.totalShares = BigInt.zero()
  vault.score = BigDecimal.fromString('10')
  vault.totalAssets = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.unclaimedAssets = BigInt.zero()
  vault.principalAssets = BigInt.zero()
  vault.isPrivate = params.isPrivate
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp

  if (params.mevEscrow != Address.zero()) {
    vault.mevEscrow = params.mevEscrow
  }

  if (vault.isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = params.admin
  }

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1
  network.save()

  createTransaction(event)

  log.info(
    '[VaultFactory] VaultCreated address={} admin={} mevEscrow={} feePercent={} capacity={}',
    [
      vaultAddressHex,
      params.admin.toHex(),
      params.mevEscrow.toHex(),
      params.feePercent.toString(),
      params.capacity.toString(),
    ]
  )
}
