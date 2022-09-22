import { BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { beforeAll, afterAll, clearStore, describe, test, assert } from 'matchstick-as'

import { handleVaultCreated } from '../src/mappings/vaultFactory'
import { handleVaultTransfer, handleValidatorsRootUpdated } from '../src/mappings/vault'

import { createVaultEvent, createValidatorsRootUpdatedEvent, createTransferEvent } from './util/events'
import { address, addressString } from './util/mock'


beforeAll(() => {
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
})

afterAll(() => {
  clearStore()
})

describe('vault', () => {

  describe('handleVaultTransfer', () => {

    test('mints shares', () => {
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

    test('burns shares', () => {
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

    test('transfer shares', () => {
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
