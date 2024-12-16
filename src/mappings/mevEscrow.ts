import { log } from '@graphprotocol/graph-ts'
import { Harvested } from '../../generated/templates/OwnMevEscrow/OwnMevEscrow'
import { createOrLoadOwnMevEscrow } from '../entities/mevEscrow'

export function handleHarvested(event: Harvested): void {
  let ownMevEscrow = createOrLoadOwnMevEscrow(event.address)
  ownMevEscrow.totalHarvestedAssets = ownMevEscrow.totalHarvestedAssets.plus(event.params.assets)
  ownMevEscrow.save()
  log.info('[OwnMevEscrow] Harvested assets={}', [event.params.assets.toString()])
}
