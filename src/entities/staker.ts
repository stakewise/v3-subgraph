import { Address, BigInt } from '@graphprotocol/graph-ts'

import { VaultStaker } from '../../generated/schema'


const createOrLoadStaker = (stakerAddress: Address, vaultAddress: Address): VaultStaker => {
  const vaultStakerAddress = `${vaultAddress.toHex()}-${stakerAddress.toHex()}`

  let vaultStaker = VaultStaker.load(vaultStakerAddress)

  if (vaultStaker === null) {
    vaultStaker = new VaultStaker(vaultStakerAddress)
    vaultStaker.shares = BigInt.fromI32(0)
    vaultStaker.address = stakerAddress
    vaultStaker.vault = vaultAddress.toHex()
    vaultStaker.save()
  }

  return vaultStaker
}


export {
  createOrLoadStaker,
}
