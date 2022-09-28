import { Address } from '@graphprotocol/graph-ts'


const zeroAddress = Address.zero()
const callerAddress = Address.fromString('0x42E7Ea23B96cff802734BbAB5Fb73d94a5187Da0')
const vaultAddress = Address.fromString('0x509DDA978268EA6cCcFE23415ddd0377ee767d6F')
const feesEscrowAddress = Address.fromString('0x9E92f7aFE7B44d8b0aD25673d178FD6bDb0bD90A')
const operatorAddress = Address.fromString('0x86E315Ff4Ec092072FE520A14a62A165C65de6Ff')

const address = new Map<string, Address>()
address.set('zero', zeroAddress)
address.set('caller', callerAddress)
address.set('vault', vaultAddress)
address.set('feesEscrow', feesEscrowAddress)
address.set('operator', operatorAddress)

const addressString = new Map<string, string>()
addressString.set('zero', zeroAddress.toHex())
addressString.set('caller', callerAddress.toHex())
addressString.set('vault', vaultAddress.toHex())
addressString.set('feesEscrow', feesEscrowAddress.toHex())
addressString.set('operator', operatorAddress.toHex())


export {
  address,
  addressString,
}
