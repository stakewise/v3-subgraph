import { newMockEvent } from 'matchstick-as'
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'

import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { CheckpointCreated } from '../../generated/templates/ExitQueue/ExitQueue'
import { Transfer, ExitQueueEntered, ValidatorsRootUpdated } from '../../generated/templates/Vault/Vault'


const createVaultEvent = (
  caller: Address,
  vault: Address,
  feesEscrow: Address,
  operator: Address,
  maxTotalAssets: string,
  feePercent: string,
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
  const maxTotalAssetsParam = new ethereum.EventParam('maxTotalAssets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(maxTotalAssets)))
  const feePercentParam = new ethereum.EventParam('feePercent', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(feePercent)))

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

const createExitQueueEnteredEvent = (
  caller: Address,
  receiver: Address,
  owner: Address,
  exitQueueId: BigInt,
  shares: BigInt,
  vaultAddress: Address
): ExitQueueEntered => {
  const mockEvent = newMockEvent()

  const mockExitQueueEnteredEvent = new ExitQueueEntered(
    vaultAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockExitQueueEnteredEvent.parameters = new Array()

  const callerParam = new ethereum.EventParam('caller', ethereum.Value.fromAddress(caller))
  const receiverParam = new ethereum.EventParam('receiver', ethereum.Value.fromAddress(receiver))
  const ownerParam = new ethereum.EventParam('owner', ethereum.Value.fromAddress(owner))
  const exitQueueIdParam = new ethereum.EventParam('exitQueueId', ethereum.Value.fromUnsignedBigInt(exitQueueId))
  const sharesParam = new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(shares))

  mockExitQueueEnteredEvent.parameters.push(callerParam)
  mockExitQueueEnteredEvent.parameters.push(receiverParam)
  mockExitQueueEnteredEvent.parameters.push(ownerParam)
  mockExitQueueEnteredEvent.parameters.push(exitQueueIdParam)
  mockExitQueueEnteredEvent.parameters.push(sharesParam)

  return mockExitQueueEnteredEvent
}

const createCheckpointCreatedEvent = (
  sharesCounter: BigInt,
  exitedAssets: BigInt,
  vaultAddress: Address
): CheckpointCreated => {
  const mockEvent = newMockEvent()

  const mockCheckpointCreatedEvent = new CheckpointCreated(
    vaultAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockCheckpointCreatedEvent.parameters = new Array()

  const sharesCounterParam = new ethereum.EventParam('sharesCounter', ethereum.Value.fromUnsignedBigInt(sharesCounter))
  const exitedAssetsParam = new ethereum.EventParam('exitedAssets', ethereum.Value.fromUnsignedBigInt(exitedAssets))

  mockCheckpointCreatedEvent.parameters.push(sharesCounterParam)
  mockCheckpointCreatedEvent.parameters.push(exitedAssetsParam)

  return mockCheckpointCreatedEvent
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
  createExitQueueEnteredEvent,
  createCheckpointCreatedEvent,
  createValidatorsRootUpdatedEvent,
}