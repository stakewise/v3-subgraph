import { BigInt, log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { Vault as VaultTemplate } from '../../generated/templates'


// Event emitted on vault create
const handleVaultCreated = (event: VaultCreated): void => {
  const block = event.block
  const params = event.params
  const vaultAddress = params.vault

  const vault = new Vault(vaultAddress.toHex())

  vault.stakers = []
  vault.checkpoints = []
  vault.exitQueueRequests = []
  vault.queuedShares = BigInt.fromI32(0)
  vault.unclaimedAssets = BigInt.fromI32(0)

  vault.operator = params.operator
  vault.feesEscrow = params.feesEscrow
  vault.feePercent = params.feePercent
  vault.maxTotalAssets = params.maxTotalAssets
  vault.createdAtBlock = block.number
  vault.createdTimestamp = block.timestamp

  vault.save()
  VaultTemplate.create(vaultAddress)

  log.info(
    '[VaultFactory] VaultCreated address={} operator={} feesEscrow={} feePercent={} maxTotalAssets={}',
    [
      params.vault.toHex(),
      params.operator.toHex(),
      params.feesEscrow.toHex(),
      params.feePercent.toString(),
      params.maxTotalAssets.toString(),
    ]
  )
}


export {
  handleVaultCreated,
}
