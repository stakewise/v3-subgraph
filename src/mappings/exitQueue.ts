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
  const hasCheckpoints = vault.get('checkpoints') !== null

  const lastCheckpointId = hasCheckpoints ? vault.checkpoints[0] : null

  let index = BigInt.fromI32(0)

  if (lastCheckpointId) {
    const lastCheckpoint = VaultCheckpoint.load(lastCheckpointId)

    if (lastCheckpoint) {
      index = lastCheckpoint.index.plus(BigInt.fromI32(1))
    }
  }

  const vaultCheckpointId = `${vaultAddress}-${index.toString()}`

  vault.totalAssets = vault.totalAssets.minus(exitedAssets)
  vault.unclaimedAssets = vault.unclaimedAssets.plus(exitedAssets)
  vault.save()

  const vaultCheckpoint = new VaultCheckpoint(vaultCheckpointId)

  vaultCheckpoint.index = index
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
