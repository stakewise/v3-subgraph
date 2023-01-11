import { BigInt, log } from '@graphprotocol/graph-ts'

import { CheckpointCreated } from '../../generated/templates/ExitQueue/ExitQueue'
import { Vault, VaultCheckpoint } from '../../generated/schema'
import { createOrLoadDaySnapshot } from '../entities/daySnapshot'


// Event emitted when shares burned. After that assets become available for claim
export function handleCheckpointCreated(event: CheckpointCreated): void {
  const params = event.params

  const sharesCounter = params.sharesCounter
  const exitedAssets = params.exitedAssets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  const index = vault.checkpoints.length
  const vaultCheckpointId = `${vaultAddress}-${index}`

  vault.totalAssets = vault.totalAssets.minus(exitedAssets)
  vault.unclaimedAssets = vault.unclaimedAssets.plus(exitedAssets)
  vault.save()

  const vaultCheckpoint = new VaultCheckpoint(vaultCheckpointId)

  vaultCheckpoint.index = BigInt.fromI32(index)
  vaultCheckpoint.sharesCounter = sharesCounter
  vaultCheckpoint.exitedAssets = exitedAssets
  vaultCheckpoint.vault = vaultAddress

  vaultCheckpoint.save()

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault.id)

  daySnapshot.totalAssets = daySnapshot.totalAssets.minus(exitedAssets)
  daySnapshot.principalAssets = daySnapshot.principalAssets.minus(exitedAssets)
  daySnapshot.save()

  log.info(
    '[ExitQueue] CheckpointCreated index={} sharesCounter={} exitedAssets={}',
    [
      index.toString(),
      sharesCounter.toString(),
      exitedAssets.toString(),
    ]
  )
}
