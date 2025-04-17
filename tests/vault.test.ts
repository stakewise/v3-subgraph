import { BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { beforeAll, afterAll, clearStore, describe, test, assert, mockIpfsFile, afterEach } from 'matchstick-as'

import { Vault } from '../generated/schema'
import {
  handleDeposit,
  handleWithdraw,
  handleTransfer,
  handleAdminUpdated,
  handleMetadataUpdated,
  handleExitQueueEntered,
  handleFeePercentUpdated,
  handleExitedAssetsClaimed,
  handleValidatorsRootUpdated,
} from '../src/mappings/vault'
import { handleCheckpointCreated } from '../src/mappings/exitQueue'

import {
  createDepositEvent,
  createWithdrawEvent,
  createTransferEvent,
  createAdminUpdatedEvent,
  createMetadataUpdatedEvent,
  createExitQueueEnteredEvent,
  createCheckpointCreatedEvent,
  createFeePercentUpdatedEvent,
  createExitedAssetsClaimedEvent,
  createValidatorsRootUpdatedEvent,
} from './util/events'
import { createVault } from './util/helpers'
import { address, addressString } from './util/mock'

export { updateMetadata } from '../src/entities/metadata'

const resetVault = (): void => {
  clearStore()
  createVault()
}

beforeAll(() => {
  createVault()
})

afterEach(() => {
  resetVault()
})

afterAll(() => {
  clearStore()
})

describe('vault', () => {
  describe('handleExitQueueEntered', () => {
    test('creates ExitRequest and increases queuedShares', () => {
      const amount = '10000'
      const exitQueueId = '0'

      const exitQueueEnteredEvent = createExitQueueEnteredEvent(
        address.get('admin'),
        address.get('admin'),
        address.get('admin'),
        BigInt.fromString(exitQueueId),
        BigInt.fromString(amount),
      )

      handleExitQueueEntered(exitQueueEnteredEvent)

      const vaultId = addressString.get('vault')
      const exitRequestId = `${vaultId}-${exitQueueId}`

      assert.fieldEquals('Vault', vaultId, 'queuedShares', '10000')
      assert.fieldEquals('ExitRequest', exitRequestId, 'vault', vaultId)
      assert.fieldEquals('ExitRequest', exitRequestId, 'owner', addressString.get('admin'))
      assert.fieldEquals('ExitRequest', exitRequestId, 'receiver', addressString.get('admin'))
      assert.fieldEquals('ExitRequest', exitRequestId, 'totalShares', amount)
      assert.fieldEquals('ExitRequest', exitRequestId, 'exitQueueId', exitQueueId)
      assert.fieldEquals('ExitRequest', exitRequestId, 'withdrawnShares', '0')
      assert.fieldEquals('ExitRequest', exitRequestId, 'withdrawnAssets', '0')
    })
  })

  describe('handleDeposit', () => {
    test('increases totalAssets on deposit', () => {
      const amount = '10000'
      const vaultId = addressString.get('vault')

      const depositEvent = createDepositEvent(address.get('admin'), BigInt.fromString(amount))

      handleDeposit(depositEvent)

      assert.fieldEquals('Vault', vaultId, 'totalAssets', amount)
    })

    // TODO add all actions tests
    test('creates allocator action on deposit', () => {
      const amount = '10000'
      const vaultId = addressString.get('vault')

      const depositEvent = createDepositEvent(address.get('admin'), BigInt.fromString(amount))

      handleDeposit(depositEvent)

      const vault = Vault.load(vaultId) as Vault

      assert.assertTrue(vault.allocatorActions.length === 1)
    })
  })

  describe('handleWithdraw', () => {
    test('decreases totalAssets on withdraw', () => {
      const amount = '10000'
      const vaultId = addressString.get('vault')

      const depositEvent = createDepositEvent(address.get('admin'), BigInt.fromString(amount))

      const withdrawEvent = createWithdrawEvent(address.get('admin'), BigInt.fromString(amount))

      handleDeposit(depositEvent)
      assert.fieldEquals('Vault', vaultId, 'totalAssets', amount)

      handleWithdraw(withdrawEvent)
      assert.fieldEquals('Vault', vaultId, 'totalAssets', '0')
    })
  })

  describe('handleTransfer', () => {
    test('mints shares if transaction from zero address', () => {
      const amount = '10000'

      const transferEvent = createTransferEvent(address.get('zero'), address.get('admin'), BigInt.fromString(amount))

      handleTransfer(transferEvent)

      const vaultId = addressString.get('vault')
      const allocatorId = addressString.get('admin')
      const vaultAllocatorId = `${vaultId}-${allocatorId}`

      assert.fieldEquals('Allocator', vaultAllocatorId, 'address', allocatorId)
      assert.fieldEquals('Allocator', vaultAllocatorId, 'shares', amount)
      assert.fieldEquals('Allocator', vaultAllocatorId, 'vault', vaultId)

      store.remove('Allocator', vaultAllocatorId)
    })

    test('burns shares if transaction to zero address', () => {
      const amount = '10000'

      const mintTransferEvent = createTransferEvent(
        address.get('zero'),
        address.get('admin'),
        BigInt.fromString(amount),
      )

      const burnTransferEvent = createTransferEvent(
        address.get('admin'),
        address.get('zero'),
        BigInt.fromString(amount),
      )

      handleTransfer(mintTransferEvent)
      handleTransfer(burnTransferEvent)

      const vaultId = addressString.get('vault')
      const allocatorId = addressString.get('admin')
      const vaultAllocatorId = `${vaultId}-${allocatorId}`

      assert.fieldEquals('Allocator', vaultAllocatorId, 'address', allocatorId)
      assert.fieldEquals('Allocator', vaultAllocatorId, 'vault', vaultId)
      assert.fieldEquals('Allocator', vaultAllocatorId, 'shares', '0')

      store.remove('Allocator', vaultAllocatorId)
    })

    test('transfers shares from one allocator to another', () => {
      const amount = '10000'

      const mintTransferEvent = createTransferEvent(
        address.get('zero'),
        address.get('admin'),
        BigInt.fromString(amount),
      )

      const transferEvent = createTransferEvent(address.get('admin'), address.get('factory'), BigInt.fromString(amount))

      handleTransfer(mintTransferEvent)
      handleTransfer(transferEvent)

      const vaultId = addressString.get('vault')
      const allocatorFromId = addressString.get('admin')
      const allocatorToId = addressString.get('factory')

      const vaultAllocatorFromId = `${vaultId}-${allocatorFromId}`
      const vaultAllocatorToId = `${vaultId}-${allocatorToId}`

      assert.fieldEquals('Allocator', vaultAllocatorFromId, 'shares', '0')
      assert.fieldEquals('Allocator', vaultAllocatorToId, 'shares', amount)

      store.remove('Allocator', vaultAllocatorFromId)
      store.remove('Allocator', vaultAllocatorToId)
    })

    test('decreases queuedShares if transaction from the vault to zero address', () => {
      const amount = '10000'
      const exitQueueId = '1'

      // increase queuedShares
      const exitQueueEnteredEvent = createExitQueueEnteredEvent(
        address.get('admin'),
        address.get('admin'),
        address.get('admin'),
        BigInt.fromString(exitQueueId),
        BigInt.fromString(amount),
      )

      // decrease queuedShares
      const burnTransferEvent = createTransferEvent(
        address.get('vault'),
        address.get('zero'),
        BigInt.fromString(amount),
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

      const depositEvent = createDepositEvent(address.get('admin'), BigInt.fromString(amount))

      const exitQueueEnteredEvent = createExitQueueEnteredEvent(
        address.get('admin'),
        address.get('admin'),
        address.get('admin'),
        BigInt.fromString(prevExitQueueId),
        BigInt.fromString(amount),
      )

      const checkpointCreatedEvent = createCheckpointCreatedEvent(BigInt.fromString(amount), BigInt.fromString(amount))

      const exitedAssetsClaimedEventEvent = createExitedAssetsClaimedEvent(
        address.get('admin'),
        address.get('admin'),
        BigInt.fromString(prevExitQueueId),
        BigInt.fromString(nextExitQueueId),
        BigInt.fromString(amount),
      )

      const burnTransferEvent = createTransferEvent(
        address.get('vault'),
        address.get('zero'),
        BigInt.fromString(amount),
      )

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'totalAssets', '0')
      assert.fieldEquals('Vault', vaultId, 'queuedShares', '0')
      assert.fieldEquals('Vault', vaultId, 'unclaimedAssets', '0')

      handleDeposit(depositEvent)
      assert.fieldEquals('Vault', vaultId, 'totalAssets', amount)

      handleExitQueueEntered(exitQueueEnteredEvent)
      assert.fieldEquals('Vault', vaultId, 'queuedShares', amount)

      handleCheckpointCreated(checkpointCreatedEvent)
      assert.fieldEquals('Vault', vaultId, 'totalAssets', '0')
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

      const validatorsRootUpdatedEvent = createValidatorsRootUpdatedEvent(validatorsRoot)

      handleValidatorsRootUpdated(validatorsRootUpdatedEvent)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'validatorsRoot', validatorsRoot.toHex())
    })
  })

  describe('handleMetadataUpdated', () => {
    test('updates vault valid metadata', () => {
      const metadataIpfsHash = 'metadataHash'

      mockIpfsFile(metadataIpfsHash, `tests/ipfs/metadataValid.json`)

      const metadataUpdatedEvent = createMetadataUpdatedEvent(metadataIpfsHash)

      handleMetadataUpdated(metadataUpdatedEvent)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'metadataIpfsHash', metadataIpfsHash)
      assert.fieldEquals('Vault', vaultId, 'displayName', 'Display Name')
      assert.fieldEquals('Vault', vaultId, 'description', 'Description')
      assert.fieldEquals('Vault', vaultId, 'imageUrl', 'https://storage.stakewise.io/image.jpg')
    })

    test('resets vault invalid metadata', () => {
      const metadataIpfsHash = 'metadataHash'

      mockIpfsFile(metadataIpfsHash, `tests/ipfs/metadataInvalid.json`)

      const metadataUpdatedEvent = createMetadataUpdatedEvent(metadataIpfsHash)

      handleMetadataUpdated(metadataUpdatedEvent)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'metadataIpfsHash', metadataIpfsHash)
      assert.fieldEquals('Vault', vaultId, 'displayName', 'null')
      assert.fieldEquals('Vault', vaultId, 'description', 'null')
      assert.fieldEquals('Vault', vaultId, 'imageUrl', 'null')
    })
  })

  describe('handleAdminUpdated', () => {
    test('updates vault admin', () => {
      const newAdmin = address.get('admin')

      const event = createAdminUpdatedEvent(newAdmin)

      handleAdminUpdated(event)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'admin', newAdmin)
    })
  })

  describe('handleFeePercentUpdated', () => {
    test('updates vault fee percent', () => {
      const feePercent = BigInt.fromI32(1000) // 10%

      const event = createFeePercentUpdatedEvent(feePercent)

      handleFeePercentUpdated(event)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'feePercent', feePercent.toString())
      assert.fieldEquals('Vault', vaultId, 'lastFeeUpdateTimestamp', event.block.timestamp.toString())
    })
  })
})
