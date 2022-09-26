import { BigInt, log } from '@graphprotocol/graph-ts'

import { CheckpointCreated } from '../../generated/templates/ExitQueue/ExitQueue'
import { Vault, VaultCheckpoint } from '../../generated/schema'


const handleCheckpointCreated = (event: CheckpointCreated): void => {
  const params = event.params

  const sharesCounter = params.sharesCounter
  const exitedAssets = params.exitedAssets
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHexString()) as Vault
  const index = vault.checkpoints.length
  const vaultCheckpointId = `${vaultAddress.toHexString()}-${index}`

  const vaultCheckpoint = new VaultCheckpoint(vaultCheckpointId)

  vaultCheckpoint.index = BigInt.fromI32(index)
  vaultCheckpoint.sharesCounter = sharesCounter
  vaultCheckpoint.exitedAssets = exitedAssets
  vaultCheckpoint.vault = vaultAddress.toHexString()

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
