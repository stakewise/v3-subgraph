import { BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { beforeAll, afterAll, clearStore, describe, test, assert } from 'matchstick-as'

import {
  handleTransfer,
  handleExitQueueEntered,
  handleExitedAssetsClaimed,
  handleValidatorsRootUpdated,
} from '../src/mappings/vault'
import { handleCheckpointCreated } from '../src/mappings/exitQueue'

import {
  createTransferEvent,
  createExitQueueEnteredEvent,
  createCheckpointCreatedEvent,
  createExitedAssetsClaimedEvent,
  createValidatorsRootUpdatedEvent
} from './util/events'
import { createVault } from './util/helpers'
import { address, addressString } from './util/mock'


const resetVault = (): void => {
  clearStore()
  createVault()
}

beforeAll(() => {
  createVault()
})

afterAll(() => {
  clearStore()
})

describe('vault', () => {

  describe('handleExitQueueEntered', () => {

    test('creates VaultExitRequest and increases queuedShares', () => {
      const amount = '10000'
      const exitQueueId = '0'

      const exitQueueEnteredEvent = createExitQueueEnteredEvent(
        address.get('operator'),
        address.get('operator'),
        address.get('operator'),
        BigInt.fromString(exitQueueId),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      handleExitQueueEntered(exitQueueEnteredEvent)

      const vaultId = addressString.get('vault')
      const exitRequestId = `${vaultId}-${exitQueueId}`

      assert.fieldEquals('Vault', vaultId, 'queuedShares', '10000')
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'vault', vaultId)
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'owner', addressString.get('operator'))
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'receiver', addressString.get('operator'))
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'totalShares', amount)
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'exitQueueId', exitQueueId)
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'withdrawnShares', '0')
      assert.fieldEquals('VaultExitRequest', exitRequestId, 'withdrawnAssets', '0')

      resetVault()
    })
  })

  describe('handleTransfer', () => {

    test('mints shares if transaction from zero address', () => {
      const amount = '10000'

      const transferEvent = createTransferEvent(
        address.get('zero'),
        address.get('operator'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      handleTransfer(transferEvent)

      const vaultId = addressString.get('vault')
      const allocatorId = addressString.get('operator')
      const vaultAllocatorId = `${vaultId}-${allocatorId}`

      assert.fieldEquals('VaultAllocator', vaultAllocatorId, 'address', allocatorId)
      assert.fieldEquals('VaultAllocator', vaultAllocatorId, 'shares', amount)
      assert.fieldEquals('VaultAllocator', vaultAllocatorId, 'vault', vaultId)

      store.remove('VaultAllocator', vaultAllocatorId)
    })

    test('burns shares if transaction to zero address', () => {
      const amount = '10000'

      const mintTransferEvent = createTransferEvent(
        address.get('zero'),
        address.get('operator'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const burnTransferEvent = createTransferEvent(
        address.get('operator'),
        address.get('zero'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      handleTransfer(mintTransferEvent)
      handleTransfer(burnTransferEvent)

      const vaultId = addressString.get('vault')
      const allocatorId = addressString.get('operator')
      const vaultAllocatorId = `${vaultId}-${allocatorId}`

      assert.fieldEquals('VaultAllocator', vaultAllocatorId, 'address', allocatorId)
      assert.fieldEquals('VaultAllocator', vaultAllocatorId, 'vault', vaultId)
      assert.fieldEquals('VaultAllocator', vaultAllocatorId, 'shares', '0')

      store.remove('VaultAllocator', vaultAllocatorId)
    })

    test('transfers shares from one allocator to another', () => {
      const amount = '10000'

      const mintTransferEvent = createTransferEvent(
        address.get('zero'),
        address.get('operator'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const transferEvent = createTransferEvent(
        address.get('operator'),
        address.get('caller'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      handleTransfer(mintTransferEvent)
      handleTransfer(transferEvent)

      const vaultId = addressString.get('vault')
      const allocatorFromId = addressString.get('operator')
      const allocatorToId = addressString.get('caller')

      const vaultAllocatorFromId = `${vaultId}-${allocatorFromId}`
      const vaultAllocatorToId = `${vaultId}-${allocatorToId}`

      assert.fieldEquals('VaultAllocator', vaultAllocatorFromId, 'shares', '0')
      assert.fieldEquals('VaultAllocator', vaultAllocatorToId, 'shares', amount)

      store.remove('VaultAllocator', vaultAllocatorFromId)
      store.remove('VaultAllocator', vaultAllocatorToId)
    })

    test('decreases queuedShares if transaction from the vault to zero address', () => {
      const amount = '10000'
      const exitQueueId = '1'

      // increase queuedShares
      const exitQueueEnteredEvent = createExitQueueEnteredEvent(
        address.get('operator'),
        address.get('operator'),
        address.get('operator'),
        BigInt.fromString(exitQueueId),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      // decrease queuedShares
      const burnTransferEvent = createTransferEvent(
        address.get('vault'),
        address.get('zero'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const vaultId = addressString.get('vault')

      handleExitQueueEntered(exitQueueEnteredEvent)
      assert.fieldEquals('Vault', vaultId, 'queuedShares', amount)

      handleTransfer(burnTransferEvent)
      assert.fieldEquals('Vault', vaultId, 'queuedShares', '0')
    })
  })

  describe('handleExitedAssetsClaimed', () => {

    test('decreases queued shares and unclaimed assets', () => {
      const amount = '10000'
      const prevExitQueueId = amount
      const nextExitQueueId = '0'

      const exitQueueEnteredEvent = createExitQueueEnteredEvent(
        address.get('operator'),
        address.get('operator'),
        address.get('operator'),
        BigInt.fromString(prevExitQueueId),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const checkpointCreatedEvent = createCheckpointCreatedEvent(
        BigInt.fromString(amount),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const exitedAssetsClaimedEventEvent = createExitedAssetsClaimedEvent(
        address.get('operator'),
        address.get('operator'),
        BigInt.fromString(prevExitQueueId),
        BigInt.fromString(nextExitQueueId),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const burnTransferEvent = createTransferEvent(
        address.get('vault'),
        address.get('zero'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      const vaultId = addressString.get('vault')

      handleExitQueueEntered(exitQueueEnteredEvent)
      assert.fieldEquals('Vault', vaultId, 'queuedShares', amount)

      handleCheckpointCreated(checkpointCreatedEvent)
      assert.fieldEquals('Vault', vaultId, 'unclaimedAssets', amount)

      handleTransfer(burnTransferEvent)
      assert.fieldEquals('Vault', vaultId, 'queuedShares', '0')

      handleExitedAssetsClaimed(exitedAssetsClaimedEventEvent)
      assert.fieldEquals('Vault', vaultId, 'unclaimedAssets', '0')
    })
  })

  describe('handleValidatorsRootUpdated', () => {

    test('updates validators root', () => {
      const validatorsRoot = Bytes.fromUTF8('root')
      const validatorsIpfsHash = 'hash'

      const validatorsRootUpdatedEvent = createValidatorsRootUpdatedEvent(
        address.get('operator'),
        validatorsRoot,
        validatorsIpfsHash,
        address.get('vault'),
      )

      handleValidatorsRootUpdated(validatorsRootUpdatedEvent)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'validatorsRoot', validatorsRoot.toHex())
      assert.fieldEquals('Vault', vaultId, 'validatorsIpfsHash', validatorsIpfsHash)
    })
  })
})
