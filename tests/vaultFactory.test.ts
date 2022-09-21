import { Address, ethereum } from '@graphprotocol/graph-ts'
import { beforeAll, describe, test, assert, clearStore, newMockEvent } from 'matchstick-as'

import { Vault } from '../generated/schema'
import { VaultCreated } from '../generated/VaultFactory/VaultFactory'

import { handleVaultCreated } from '../src/mappings/vaultFactory'


// Random addresses
const callerAddress = Address.fromString('0x42E7Ea23B96cff802734BbAB5Fb73d94a5187Da0')
const vaultAddress = Address.fromString('0x509DDA978268EA6cCcFE23415ddd0377ee767d6F')
const feesEscrowAddress = Address.fromString('0x9E92f7aFE7B44d8b0aD25673d178FD6bDb0bD90A')
const operatorAddress = Address.fromString('0x86E315Ff4Ec092072FE520A14a62A165C65de6Ff')

const createVaultEvent = (
  caller: Address,
  vault: Address,
  feesEscrow: Address,
  operator: Address,
  maxTotalAssets: i32,
  feePercent: i32,
): VaultCreated => {
  const mockEvent = newMockEvent()

  const mockVaultCreatedEvent = new VaultCreated(
    mockEvent.address,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockVaultCreatedEvent.parameters = new Array()

  const callerParam = new ethereum.EventParam('caller', ethereum.Value.fromAddress(caller))
  const vaultParam = new ethereum.EventParam('vault', ethereum.Value.fromAddress(vault))
  const feesEscrowParam = new ethereum.EventParam('feesEscrow', ethereum.Value.fromAddress(feesEscrow))
  const operatorParam = new ethereum.EventParam('operator', ethereum.Value.fromAddress(operator))
  const maxTotalAssetsParam = new ethereum.EventParam('maxTotalAssets', ethereum.Value.fromI32(maxTotalAssets))
  const feePercentParam = new ethereum.EventParam('feePercent', ethereum.Value.fromI32(feePercent))

  mockVaultCreatedEvent.parameters.push(callerParam)
  mockVaultCreatedEvent.parameters.push(vaultParam)
  mockVaultCreatedEvent.parameters.push(feesEscrowParam)
  mockVaultCreatedEvent.parameters.push(operatorParam)
  mockVaultCreatedEvent.parameters.push(maxTotalAssetsParam)
  mockVaultCreatedEvent.parameters.push(feePercentParam)

  return mockVaultCreatedEvent
}

beforeAll(() => {
  clearStore()
})

describe('vaultFactory', () => {

  describe('handleVaultCreated', () => {

    test('creates a new Vault', () => {
      const maxTotalAssets = 10000
      const feePercent = 10

      const vaultEvent = createVaultEvent(
        callerAddress,
        vaultAddress,
        feesEscrowAddress,
        operatorAddress,
        maxTotalAssets,
        feePercent,
      )

      handleVaultCreated(vaultEvent)

      const vaultId = vaultAddress.toHexString()

      assert.fieldEquals('Vault', vaultId, 'feesEscrow', feesEscrowAddress.toHexString())
      assert.fieldEquals('Vault', vaultId, 'operator', operatorAddress.toHexString())
      assert.fieldEquals('Vault', vaultId, 'maxTotalAssets', '10000')
      assert.fieldEquals('Vault', vaultId, 'feePercent', '10')
    })
  })
})
