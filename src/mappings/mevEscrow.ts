import { log, dataSource } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested } from '../../generated/templates/OwnMevEscrow/OwnMevEscrow'
import { GNO_USD_PRICE_FEED, ZERO_ADDRESS } from '../helpers/constants'
import { createOrLoadVaultsStat } from '../entities/vaults'

// Event emitted on OwnMevEscrow harvesting rewards
export function handleHarvested(event: Harvested): void {
  if (GNO_USD_PRICE_FEED !== ZERO_ADDRESS) {
    // ignore for gnosis networks
    return
  }
  const totalAssetsDelta = event.params.assets
  const context = dataSource.context()
  const vaultId = context.getString('vault')
  const vault = Vault.load(vaultId) as Vault
  vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  if (vault.totalAssets.lt(vault.principalAssets)) {
    const vaultsStat = createOrLoadVaultsStat()
    vaultsStat.totalAssets = vaultsStat.totalAssets.plus(vault.principalAssets).minus(vault.totalAssets)
    vaultsStat.save()
    vault.totalAssets = vault.principalAssets
  }
  vault.save()
  log.info('[OwnMevEscrow] Harvested vault={} totalAssetsDelta={}', [vaultId, totalAssetsDelta.toString()])
}
