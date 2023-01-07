import { Address } from '@graphprotocol/graph-ts'


const zeroAddress = Address.zero()
const vaultAddress = Address.fromString('0x509DDA978268EA6cCcFE23415ddd0377ee767d6F')
const adminAddress = Address.fromString('0x86E315Ff4Ec092072FE520A14a62A165C65de6Ff')
const factoryAddress = Address.fromString('0x42E7Ea23B96cff802734BbAB5Fb73d94a5187Da0')
const mevEscrowAddress = Address.fromString('0x9E92f7aFE7B44d8b0aD25673d178FD6bDb0bD90A')

const address = new Map<string, Address>()
address.set('zero', zeroAddress)
address.set('admin', adminAddress)
address.set('vault', vaultAddress)
address.set('factory', factoryAddress)
address.set('mevEscrow', mevEscrowAddress)

const addressString = new Map<string, string>()
addressString.set('zero', zeroAddress.toHex())
addressString.set('admin', adminAddress.toHex())
addressString.set('vault', vaultAddress.toHex())
addressString.set('factory', factoryAddress.toHex())
addressString.set('mevEscrow', mevEscrowAddress.toHex())


export {
  address,
  addressString,
}
