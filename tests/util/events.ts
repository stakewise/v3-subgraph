import { newMockEvent } from 'matchstick-as'
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'

import { Transfer, ValidatorsRootUpdated } from '../../generated/templates/Vault/Vault'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'


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

const createTransferEvent = (
  from: Address,
  to: Address,
  amount: BigInt,
  vaultAddress: Address,
): Transfer => {
  const mockEvent = newMockEvent()

  const mockTransferEvent = new Transfer(
    vaultAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockTransferEvent.parameters = new Array()

  const fromParam = new ethereum.EventParam('from', ethereum.Value.fromAddress(from))
  const toParam = new ethereum.EventParam('to', ethereum.Value.fromAddress(to))
  const amountParam = new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(amount))

  mockTransferEvent.parameters.push(fromParam)
  mockTransferEvent.parameters.push(toParam)
  mockTransferEvent.parameters.push(amountParam)

  return mockTransferEvent
}

const createValidatorsRootUpdatedEvent = (
  caller: Address,
  newValidatorsRoot: Bytes,
  newValidatorsIpfsHash: string,
  vaultAddress: Address
): ValidatorsRootUpdated => {
  const mockEvent = newMockEvent()

  const mockValidatorsRootUpdatedEvent = new ValidatorsRootUpdated(
    vaultAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockValidatorsRootUpdatedEvent.parameters = new Array()

  const callerParam = new ethereum.EventParam('caller', ethereum.Value.fromAddress(caller))
  const newValidatorsRootParam = new ethereum.EventParam('newValidatorsRoot', ethereum.Value.fromBytes(newValidatorsRoot))
  const newValidatorsIpfsHashParam = new ethereum.EventParam('newValidatorsIpfsHash', ethereum.Value.fromString(newValidatorsIpfsHash))

  mockValidatorsRootUpdatedEvent.parameters.push(callerParam)
  mockValidatorsRootUpdatedEvent.parameters.push(newValidatorsRootParam)
  mockValidatorsRootUpdatedEvent.parameters.push(newValidatorsIpfsHashParam)

  return mockValidatorsRootUpdatedEvent
}


export {
  createVaultEvent,
  createTransferEvent,
  createValidatorsRootUpdatedEvent,
}
