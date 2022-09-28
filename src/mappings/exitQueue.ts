import { BigInt, log } from '@graphprotocol/graph-ts'

import { CheckpointCreated } from '../../generated/templates/ExitQueue/ExitQueue'
import { Vault, VaultCheckpoint } from '../../generated/schema'


// Event emitted when shares burned. After that assets become available for claim
const handleCheckpointCreated = (event: CheckpointCreated): void => {
  const params = event.params

  const sharesCounter = params.sharesCounter
  const exitedAssets = params.exitedAssets
  const vaultAddress = event.address.toHex()

  const vault = Vault.load(vaultAddress) as Vault

  const index = vault.checkpoints.length
  const vaultCheckpointId = `${vaultAddress}-${index}`

  vault.unclaimedAssets = vault.unclaimedAssets.plus(exitedAssets)
  vault.save()

  const vaultCheckpoint = new VaultCheckpoint(vaultCheckpointId)

  vaultCheckpoint.index = BigInt.fromI32(index)
  vaultCheckpoint.sharesCounter = sharesCounter
  vaultCheckpoint.exitedAssets = exitedAssets
  vaultCheckpoint.vault = vaultAddress

  vaultCheckpoint.save()

  log.info(
    '[ExitQueue] CheckpointCreated index={} sharesCounter={} exitedAssets={}',
    [
      index.toString(),
      sharesCounter.toString(),
      exitedAssets.toString(),
    ]
  )
}


export {
  handleCheckpointCreated,
}
