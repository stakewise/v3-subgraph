import { BigInt, log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { XdaiSwapped } from '../../generated/templates/GnoVault/GnoVault'

// Event emitted when xDAI is swapped to GNO
export function handleXdaiSwapped(event: XdaiSwapped): void {
  const params = event.params
  const vaultAddress = event.address
  let gnoAssets = params.assets
  const xdaiAssets = params.amount

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.unconvertedExecutionReward = vault.unconvertedExecutionReward.le(xdaiAssets)
    ? BigInt.zero()
    : vault.unconvertedExecutionReward.minus(xdaiAssets)
  vault.save()

  log.info('[GnoVault] XdaiSwapped vault={} xdai={} gno={}', [
    vaultAddress.toHexString(),
    xdaiAssets.toString(),
    gnoAssets.toString(),
  ])
}
