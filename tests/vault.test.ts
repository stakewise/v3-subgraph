import { BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { beforeAll, afterAll, clearStore, describe, test, assert } from 'matchstick-as'

import { handleVaultCreated } from '../src/mappings/vaultFactory'
import { handleVaultTransfer, handleValidatorsRootUpdated, handleExitQueueEntered } from '../src/mappings/vault'

import {
  createVaultEvent,
  createValidatorsRootUpdatedEvent,
  createTransferEvent,
  createExitQueueEnteredEvent
} from './util/events'
import { address, addressString } from './util/mock'


const createVault = (): void => {
  const maxTotalAssets = 10000
  const feePercent = 10

  const vaultEvent = createVaultEvent(
    address.get('caller'),
    address.get('vault'),
    address.get('feesEscrow'),
    address.get('operator'),
    maxTotalAssets,
    feePercent,
  )

  handleVaultCreated(vaultEvent)
}

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

    test('increases queuedShares', () => {
      const amount = '10000'
      const exitQueueId = '1'

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

      assert.fieldEquals('Vault', vaultId, 'queuedShares', '10000')

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
      assert.fieldEquals('VaultStaker', vaultStakerId, 'vault', vaultId)
      assert.fieldEquals('VaultStaker', vaultStakerId, 'shares', amount)

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

      handleExitQueueEntered(exitQueueEnteredEvent)
      handleVaultTransfer(burnTransferEvent)

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'queuedShares', '0')
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

      assert.fieldEquals('Vault', vaultId, 'validatorsRoot', validatorsRoot.toHexString())
      assert.fieldEquals('Vault', vaultId, 'validatorsIpfsHash', validatorsIpfsHash)
    })
  })
})
