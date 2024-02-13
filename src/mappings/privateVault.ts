import { BigInt, log, store } from '@graphprotocol/graph-ts'

import { WhitelistUpdated, WhitelisterUpdated } from '../../generated/templates/PrivateVault/PrivateVault'
import { PrivateVaultAccount, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'

export function handleWhitelistUpdated(event: WhitelistUpdated): void {
  const params = event.params
  const address = params.account
  const approved = params.approved

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault
  const id = `${vaultAddress}-${address.toHex()}`

  if (approved) {
    const privateVaultAccount = new PrivateVaultAccount(id)

    privateVaultAccount.vault = vaultAddress
    privateVaultAccount.address = address
    privateVaultAccount.createdAt = event.block.timestamp
    vault.whitelistCount = vault.whitelistCount.plus(BigInt.fromI32(1))

    privateVaultAccount.save()
  } else {
    vault.whitelistCount = vault.whitelistCount.minus(BigInt.fromI32(1))

    store.remove('PrivateVaultAccount', id)
  }

  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[PrivateVault] WhitelistUpdated vault={} approved={}', [vaultAddress, approved ? 'true' : 'false'])
}

export function handleWhitelisterUpdated(event: WhitelisterUpdated): void {
  const params = event.params
  const whitelister = params.whitelister

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.whitelister = whitelister
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[PrivateVault] WhitelisterUpdated vault={} whitelister={}', [vaultAddress, whitelister.toHex()])
}
