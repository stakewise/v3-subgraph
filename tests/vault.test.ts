import { BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { beforeAll, afterAll, clearStore, describe, test, assert } from 'matchstick-as'

import {
  handleVaultTransfer,
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

  describe('handleVaultTransfer', () => {

    test('mints shares if transaction from zero address', () => {
      const amount = '10000'

      const transferEvent = createTransferEvent(
        address.get('zero'),
        address.get('operator'),
        BigInt.fromString(amount),
        address.get('vault'),
      )

      handleVaultTransfer(transferEvent)

      const vaultId = addressString.get('vault')
      const stakerId = addressString.get('operator')
      const vaultStakerId = `${vaultId}-${stakerId}`

      assert.fieldEquals('VaultStaker', vaultStakerId, 'address', stakerId)
      assert.fieldEquals('VaultStaker', vaultStakerId, 'shares', amount)
      assert.fieldEquals('VaultStaker', vaultStakerId, 'vault', vaultId)

      store.remove('VaultStaker', vaultStakerId)
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

      handleVaultTransfer(mintTransferEvent)
      handleVaultTransfer(burnTransferEvent)

      const vaultId = addressString.get('vault')
      const stakerId = addressString.get('operator')
      const vaultStakerId = `${vaultId}-${stakerId}`

      assert.fieldEquals('VaultStaker', vaultStakerId, 'address', stakerId)
      assert.fieldEquals('VaultStaker', vaultStakerId, 'vault', vaultId)
      assert.fieldEquals('VaultStaker', vaultStakerId, 'shares', '0')

      store.remove('VaultStaker', vaultStakerId)
    })

    test('transfers shares from one staker to another', () => {
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

      handleVaultTransfer(mintTransferEvent)
      handleVaultTransfer(transferEvent)

      const vaultId = addressString.get('vault')
      const stakerFromId = addressString.get('operator')
      const stakerToId = addressString.get('caller')

      const vaultStakerFromId = `${vaultId}-${stakerFromId}`
      const vaultStakerToId = `${vaultId}-${stakerToId}`

      assert.fieldEquals('VaultStaker', vaultStakerFromId, 'shares', '0')
      assert.fieldEquals('VaultStaker', vaultStakerToId, 'shares', amount)

      store.remove('VaultStaker', vaultStakerFromId)
      store.remove('VaultStaker', vaultStakerToId)
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

      handleVaultTransfer(burnTransferEvent)
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

      handleVaultTransfer(burnTransferEvent)
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
