import { log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { XdaiSwapped, XdaiManagerUpdated } from '../../generated/templates/GnoVault/GnoVault'
import { createOrLoadVaultsStat } from '../entities/vaults'
import { createTransaction } from '../entities/transaction'

// Event emitted when xDAI is swapped to GNO
export function handleXdaiSwapped(event: XdaiSwapped): void {
  const params = event.params
  const vaultAddress = event.address
  const assets = params.assets

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.totalAssets = vaultsStat.totalAssets.plus(assets)
  vaultsStat.save()

  log.info('[GnoVault] XdaiSwapped vault={} xdai={} gno={}', [
    vaultAddress.toHexString(),
    params.amount.toString(),
    assets.toString(),
  ])
}

// Event emitted when xDAI manager is updated
export function handleXdaiManagerUpdated(event: XdaiManagerUpdated): void {
  const params = event.params
  const vaultAddress = event.address
  const xdaiManager = params.xdaiManager

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.xdaiManager = xdaiManager
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[GnoVault] XdaiManagerUpdated vault={} xdaiManager={}', [
    vaultAddress.toHexString(),
    xdaiManager.toHexString(),
  ])
}
