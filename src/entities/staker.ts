import { Address } from '@graphprotocol/graph-ts'

import { VaultStaker } from '../../generated/schema'


const createOrLoadStaker = (stakerAddress: Address, vaultAddress: Address): VaultStaker => {
  const vaultStakerAddress = `${vaultAddress.toHexString()}-${stakerAddress.toHexString()}`

  let vaultStaker = VaultStaker.load(vaultStakerAddress)

  if (vaultStaker === null) {
    vaultStaker = new VaultStaker(vaultStakerAddress)
    vaultStaker.address = stakerAddress
    vaultStaker.vault = vaultAddress.toHexString()
    vaultStaker.save()
  }

  return vaultStaker
}


export {
  createOrLoadStaker,
}
