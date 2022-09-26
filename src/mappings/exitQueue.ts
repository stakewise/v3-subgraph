import { Vault, VaultCheckpoint } from '../../generated/schema'
import { CheckpointCreated } from '../../generated/templates/ExitQueue/ExitQueue'
import { BigInt, log } from '@graphprotocol/graph-ts'


const handleCheckpointCreated = (event: CheckpointCreated): void => {
  const params = event.params

  const sharesCounter = params.sharesCounter
  const exitedAssets = params.exitedAssets
  const vaultAddress = event.address

  const vault = Vault.load(vaultAddress.toHexString()) as Vault
  const checkpointIndex = vault.checkpoints.length
  const vaultCheckpointId = `${vaultAddress.toHexString()}-${checkpointIndex}`

  const vaultCheckpoint = new VaultCheckpoint(vaultCheckpointId)

  vaultCheckpoint.checkpointIndex = BigInt.fromI32(checkpointIndex)
  vaultCheckpoint.sharesCounter = sharesCounter
  vaultCheckpoint.exitedAssets = exitedAssets
  vaultCheckpoint.vault = vaultAddress.toHexString()

  vaultCheckpoint.save()

  log.info(
    '[ExitQueue] CheckpointCreated index={} sharesCounter={} exitedAssets={}',
    [
      checkpointIndex.toString(),
      sharesCounter.toString(),
      exitedAssets.toString(),
    ]
  )
}


export {
  handleCheckpointCreated,
}
