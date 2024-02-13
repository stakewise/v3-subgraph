import { BigInt, log, store } from '@graphprotocol/graph-ts'

import { BlocklistManagerUpdated, BlocklistUpdated } from '../../generated/templates/BlocklistVault/BlocklistVault'
import { VaultBlockedAccount, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'

export function handleBlocklistUpdated(event: BlocklistUpdated): void {
  const params = event.params
  const address = params.account
  const blocked = params.isBlocked

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault
  const id = `${vaultAddress}-${address.toHex()}`

  if (blocked) {
    const blockedAccount = new VaultBlockedAccount(id)

    blockedAccount.vault = vaultAddress
    blockedAccount.address = address
    blockedAccount.createdAt = event.block.timestamp
    vault.blocklistCount = vault.blocklistCount.plus(BigInt.fromI32(1))

    blockedAccount.save()
  } else {
    vault.blocklistCount = vault.blocklistCount.minus(BigInt.fromI32(1))

    store.remove('VaultBlockedAccount', id)
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[BlocklistVault] BlocklistUpdated vault={} account={} blocked={}', [
    vaultAddress,
    address.toHex(),
    blocked ? 'true' : 'false',
  ])
}

export function handleBlocklistManagerUpdated(event: BlocklistManagerUpdated): void {
  const params = event.params
  const blocklistManager = params.blocklistManager

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.blocklistManager = blocklistManager
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[PrivateVault] BlocklistManagerUpdated vault={} blocklistManager={}', [
    vaultAddress,
    blocklistManager.toHex(),
  ])
}
