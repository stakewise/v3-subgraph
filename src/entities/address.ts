import { Address } from '@graphprotocol/graph-ts'

import { ContractAddress } from '../../generated/schema'

export function loadContractAddress(address: Address): ContractAddress | null {
  return ContractAddress.load(address.toString())
}

export function createContractAddress(address: Address): void {
  let contractAddress = ContractAddress.load(address.toHex())
  if (contractAddress === null) {
    contractAddress = new ContractAddress(address.toHex())
    contractAddress.save()
  }
}
