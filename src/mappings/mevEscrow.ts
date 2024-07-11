import { log, dataSource } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested } from '../../generated/templates/OwnMevEscrow/OwnMevEscrow'
import { isGnosisNetwork } from '../helpers/utils'

// Event emitted on OwnMevEscrow harvesting rewards
export function handleHarvested(event: Harvested): void {
  // ignore for gnosis networks
  if (isGnosisNetwork()) return

  const totalAssetsDelta = event.params.assets
  const context = dataSource.context()
  const vaultId = context.getString('vault')
  const vault = Vault.load(vaultId) as Vault
  vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  vault.save()
  log.info('[OwnMevEscrow] Harvested vault={} totalAssetsDelta={}', [vaultId, totalAssetsDelta.toString()])
}
