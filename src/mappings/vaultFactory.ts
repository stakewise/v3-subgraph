import { Vault } from '../../generated/schema'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'


const handleVaultCreated = (event: VaultCreated): void => {
  const block = event.block
  const params = event.params

  const vault = new Vault(params.vault.toHexString())

  vault.operator = params.operator
  vault.feesEscrow = params.feesEscrow
  vault.feePercent = params.feePercent
  vault.maxTotalAssets = params.maxTotalAssets
  vault.createdAtBlock = block.number
  vault.createdTimestamp = block.timestamp

  vault.save()
}


export {
  handleVaultCreated,
}
