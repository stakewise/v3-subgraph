import { Vault } from '../../generated/schema'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { Vault as VaultTemplate } from '../../generated/templates'


const handleVaultCreated = (event: VaultCreated): void => {
  const block = event.block
  const params = event.params
  const vaultAddress = params.vault

  const vault = new Vault(vaultAddress.toHexString())

  vault.operator = params.operator
  vault.feesEscrow = params.feesEscrow
  vault.feePercent = params.feePercent
  vault.maxTotalAssets = params.maxTotalAssets
  vault.createdAtBlock = block.number
  vault.createdTimestamp = block.timestamp

  vault.save()
  VaultTemplate.create(vaultAddress)
}


export {
  handleVaultCreated,
}
