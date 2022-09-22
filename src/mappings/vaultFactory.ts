import { log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { Vault as VaultTemplate } from '../../generated/templates'


const handleVaultCreated = (event: VaultCreated): void => {
  const block = event.block
  const params = event.params
  const vaultAddress = params.vault

  const vault = new Vault(vaultAddress.toHexString())

  vault.stakers = []
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
      params.vault.toHexString(),
      params.operator.toHexString(),
      params.feesEscrow.toHexString(),
      params.feePercent.toString(),
      params.maxTotalAssets.toString(),
    ]
  )
}


export {
  handleVaultCreated,
}
