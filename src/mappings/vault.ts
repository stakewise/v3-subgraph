import { Vault } from '../../generated/schema'
import { Transfer, ValidatorsRootUpdated } from '../../generated/templates/Vault/Vault'


const handleVaultTransfer = (event: Transfer): void => {
  const params = event.params

  const from = params.from
  const to = params.to
  const value = params.value
}

const handleValidatorsRootUpdated = (event: ValidatorsRootUpdated): void => {
  const params = event.params

  const validatorsRoot = params.newValidatorsRoot
  const validatorsIpfsHash = params.newValidatorsIpfsHash

  const vault = Vault.load(event.address.toHex()) as Vault

  vault.validatorsRoot = validatorsRoot
  vault.validatorsIpfsHash = validatorsIpfsHash

  vault.save()
}


export {
  handleVaultTransfer,
  handleValidatorsRootUpdated,
}
