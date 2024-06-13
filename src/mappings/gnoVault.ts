import { BigInt, log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { XdaiSwapped } from '../../generated/templates/GnoVault/GnoVault'
import { createOrLoadVaultsStat } from '../entities/vaults'

// Event emitted when xDAI is swapped to GNO
export function handleXdaiSwapped(event: XdaiSwapped): void {
  const params = event.params
  const vaultAddress = event.address
  const assets = params.assets

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(assets)
  vault.principalAssets = vault.principalAssets.plus(assets)
  if (vault.unconvertedExecutionReward.le(params.amount)) {
    vault.unconvertedExecutionReward = BigInt.zero()
  } else {
    vault.unconvertedExecutionReward = vault.unconvertedExecutionReward.minus(params.amount)
  }
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
