import { newMockEvent } from 'matchstick-as'
import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'

import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { CheckpointCreated } from '../../generated/templates/ExitQueue/ExitQueue'
import { WhitelistUpdated } from '../../generated/templates/PrivateVault/PrivateVault'
import {
  Deposit,
  Transfer,
  Withdraw,
  MetadataUpdated,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated,
} from '../../generated/templates/Vault/Vault'

import { address } from './mock'


const createVaultEvent = (
  caller: Address,
  admin: Address,
  vault: Address,
  mevEscrow: Address,
  name: string,
  symbol: string,
  capacity: string,
  feePercent: string,
): VaultCreated => {
  const mockEvent = newMockEvent()

  const mockVaultCreatedEvent = new VaultCreated(
    caller,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockVaultCreatedEvent.parameters = new Array()

  const adminParam = new ethereum.EventParam('admin', ethereum.Value.fromAddress(admin))
  const vaultParam = new ethereum.EventParam('vault', ethereum.Value.fromAddress(vault))
  const isPrivateParam = new ethereum.EventParam('isPrivate', ethereum.Value.fromBoolean(false))
  const mevEscrowParam = new ethereum.EventParam('mevEscrow', ethereum.Value.fromAddress(mevEscrow))
  const nameParam = new ethereum.EventParam('name', ethereum.Value.fromString(name))
  const symbolParam = new ethereum.EventParam('symbol', ethereum.Value.fromString(symbol))
  const capacityParam = new ethereum.EventParam('capacity', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(capacity)))
  const feePercentParam = new ethereum.EventParam('feePercent', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(feePercent)))

  mockVaultCreatedEvent.parameters.push(adminParam)
  mockVaultCreatedEvent.parameters.push(vaultParam)
  mockVaultCreatedEvent.parameters.push(isPrivateParam)
  mockVaultCreatedEvent.parameters.push(mevEscrowParam)
  mockVaultCreatedEvent.parameters.push(capacityParam)
  mockVaultCreatedEvent.parameters.push(feePercentParam)
  mockVaultCreatedEvent.parameters.push(nameParam)
  mockVaultCreatedEvent.parameters.push(symbolParam)

  return mockVaultCreatedEvent
}

const createDepositEvent = (
  owner: Address,
  assets: BigInt,
): Deposit => {
  const mockEvent = newMockEvent()

  const mockDepositEvent = new Deposit(
    address.get('vault'),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockDepositEvent.parameters = new Array()

  const callerParam = new ethereum.EventParam('caller', ethereum.Value.fromAddress(owner))
  const ownerParam = new ethereum.EventParam('owner', ethereum.Value.fromAddress(owner))
  const assetsParam = new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(assets))
  const sharesParam = new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(assets))

  mockDepositEvent.parameters.push(callerParam)
  mockDepositEvent.parameters.push(ownerParam)
  mockDepositEvent.parameters.push(assetsParam)
  mockDepositEvent.parameters.push(sharesParam)

  return mockDepositEvent
}

const createWithdrawEvent = (
  owner: Address,
  assets: BigInt,
): Withdraw => {
  const mockEvent = newMockEvent()

  const mockWithdrawEvent = new Withdraw(
    address.get('vault'),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockWithdrawEvent.parameters = new Array()

  const callerParam = new ethereum.EventParam('caller', ethereum.Value.fromAddress(owner))
  const ownerParam = new ethereum.EventParam('owner', ethereum.Value.fromAddress(owner))
  const assetsParam = new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(assets))
  const sharesParam = new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(assets))

  mockWithdrawEvent.parameters.push(callerParam)
  mockWithdrawEvent.parameters.push(ownerParam)
  mockWithdrawEvent.parameters.push(assetsParam)
  mockWithdrawEvent.parameters.push(sharesParam)

  return mockWithdrawEvent
}

const createTransferEvent = (
  from: Address,
  to: Address,
  amount: BigInt,
): Transfer => {
  const mockEvent = newMockEvent()

  const mockTransferEvent = new Transfer(
    address.get('vault'),
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
): ExitQueueEntered => {
  const mockEvent = newMockEvent()

  const mockExitQueueEnteredEvent = new ExitQueueEntered(
    address.get('vault'),
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
): CheckpointCreated => {
  const mockEvent = newMockEvent()

  const mockCheckpointCreatedEvent = new CheckpointCreated(
    address.get('vault'),
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

const createExitedAssetsClaimedEvent = (
  caller: Address,
  receiver: Address,
  prevExitQueueId: BigInt,
  nextExitQueueId: BigInt,
  withdrawnAssets: BigInt,
): ExitedAssetsClaimed => {
  const mockEvent = newMockEvent()

  const mockExitedAssetsClaimedEvent = new ExitedAssetsClaimed(
    address.get('vault'),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockExitedAssetsClaimedEvent.parameters = new Array()

  const callerParam = new ethereum.EventParam('caller', ethereum.Value.fromAddress(caller))
  const receiverParam = new ethereum.EventParam('receiver', ethereum.Value.fromAddress(receiver))
  const prevExitQueueIdParam = new ethereum.EventParam('prevExitQueueId', ethereum.Value.fromUnsignedBigInt(prevExitQueueId))
  const nextExitQueueIdParam = new ethereum.EventParam('nextExitQueueId', ethereum.Value.fromUnsignedBigInt(nextExitQueueId))
  const withdrawnAssetsParam = new ethereum.EventParam('withdrawnAssets', ethereum.Value.fromUnsignedBigInt(withdrawnAssets))

  mockExitedAssetsClaimedEvent.parameters.push(callerParam)
  mockExitedAssetsClaimedEvent.parameters.push(receiverParam)
  mockExitedAssetsClaimedEvent.parameters.push(prevExitQueueIdParam)
  mockExitedAssetsClaimedEvent.parameters.push(nextExitQueueIdParam)
  mockExitedAssetsClaimedEvent.parameters.push(withdrawnAssetsParam)

  return mockExitedAssetsClaimedEvent
}

const createMetadataUpdatedEvent = (
  metadataIpfsHash: string,
): MetadataUpdated => {
  const mockEvent = newMockEvent()

  const mockMetadataUpdatedEvent = new MetadataUpdated(
    address.get('vault'),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockMetadataUpdatedEvent.parameters = new Array()

  const metadataIpfsHashParam = new ethereum.EventParam('metadataIpfsHash', ethereum.Value.fromString(metadataIpfsHash))

  mockMetadataUpdatedEvent.parameters.push(metadataIpfsHashParam)

  return mockMetadataUpdatedEvent
}

const createWhitelistUpdatedEvent = (
  accountAddress: string,
  approved: boolean
): WhitelistUpdated => {
  const mockEvent = newMockEvent()

  const mockWhitelistUpdatedEvent = new WhitelistUpdated(
    address.get('vault'),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockWhitelistUpdatedEvent.parameters = new Array()

  const senderParam = new ethereum.EventParam('sender', ethereum.Value.fromAddress(address.get('admin')))
  const accountParam = new ethereum.EventParam('account', ethereum.Value.fromAddress(Address.fromString(accountAddress)))
  const approvedParam = new ethereum.EventParam('approved', ethereum.Value.fromBoolean(approved))

  mockWhitelistUpdatedEvent.parameters.push(senderParam)
  mockWhitelistUpdatedEvent.parameters.push(accountParam)
  mockWhitelistUpdatedEvent.parameters.push(approvedParam)

  return mockWhitelistUpdatedEvent
}

const createValidatorsRootUpdatedEvent = (
  validatorsRoot: Bytes,
): ValidatorsRootUpdated => {
  const mockEvent = newMockEvent()

  const mockValidatorsRootUpdatedEvent = new ValidatorsRootUpdated(
    address.get('vault'),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null
  )

  mockValidatorsRootUpdatedEvent.parameters = new Array()

  const validatorsRootParam = new ethereum.EventParam('validatorsRoot', ethereum.Value.fromBytes(validatorsRoot))

  mockValidatorsRootUpdatedEvent.parameters.push(validatorsRootParam)

  return mockValidatorsRootUpdatedEvent
}


export {
  createVaultEvent,
  createDepositEvent,
  createWithdrawEvent,
  createTransferEvent,
  createMetadataUpdatedEvent,
  createWhitelistUpdatedEvent,
  createExitQueueEnteredEvent,
  createCheckpointCreatedEvent,
  createExitedAssetsClaimedEvent,
  createValidatorsRootUpdatedEvent,
}
