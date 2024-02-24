import { log, dataSource } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested } from '../../generated/templates/OwnMevEscrow/OwnMevEscrow'

// Event emitted on OwnMevEscrow harvesting rewards
export function handleHarvested(event: Harvested): void {
  const totalAssetsDelta = event.params.assets
  const context = dataSource.context()
  const vaultId = context.getString('vault')
  const vault = Vault.load(vaultId) as Vault
  vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  if (vault.totalAssets.lt(vault.principalAssets)) {
    vault.totalAssets = vault.principalAssets
  }
  vault.save()
  log.info('[OwnMevEscrow] Harvested vault={} totalAssetsDelta={}', [vaultId, totalAssetsDelta.toString()])
}
