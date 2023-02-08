import { log, store } from '@graphprotocol/graph-ts'

import { WhitelistUpdated, WhitelisterUpdated } from '../../generated/templates/PrivateVault/PrivateVault'
import { PrivateVaultAccount, Vault } from '../../generated/schema'


export function handleWhitelistUpdated(event: WhitelistUpdated): void {
  const params = event.params
  const address = params.account
  const approved = params.approved

  const vaultAddress = event.address.toHex()
  const id = `${vaultAddress}-${address.toHex()}`

  if (approved) {
    const privateVaultAccount = new PrivateVaultAccount(id)

    privateVaultAccount.vault = vaultAddress
    privateVaultAccount.address = address

    privateVaultAccount.save()
  }
  else {
    store.remove('PrivateVaultAccount', id)
  }

  log.info(
    '[PrivateVault] WhitelistUpdated vault={} approved={}',
    [
      vaultAddress,
      approved ? 'true' : 'false',
    ]
  )
}

export function handleWhitelisterUpdated(event: WhitelisterUpdated): void {
  const params = event.params
  const whitelister = params.whitelister

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.whitelister = whitelister
  vault.save()

  log.info(
    '[PrivateVault] WhitelisterUpdated vault={} whitelister={}',
    [
      vaultAddress,
      whitelister.toHex(),
    ]
  )
}
