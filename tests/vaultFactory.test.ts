import { afterEach, describe, test, assert, clearStore } from 'matchstick-as'

import { Vault } from '../generated/schema'
import { handleVaultCreated } from '../src/mappings/vaultFactory'

import { address, addressString } from './util/mock'
import { createVaultEvent } from './util/events'


afterEach(() => {
  clearStore()
})

describe('vaultFactory', () => {

  describe('handleVaultCreated', () => {

    test('creates a new Vault', () => {
      const name = 'name'
      const symbol = 'symbol'
      const capacity = '10000'
      const feePercent = '10'

      const adminAddress = addressString.get('admin')
      const vaultAddress = addressString.get('vault')
      const factoryAddress = addressString.get('factory')
      const mevEscrowAddress = addressString.get('mevEscrow')

      const vaultEvent = createVaultEvent(
        address.get('factory'),
        address.get('admin'),
        address.get('vault'),
        address.get('mevEscrow'),
        name,
        symbol,
        capacity,
        feePercent,
      )

      handleVaultCreated(vaultEvent)

      assert.fieldEquals('Vault', vaultAddress, 'admin', adminAddress)
      assert.fieldEquals('Vault', vaultAddress, 'factory', factoryAddress)
      assert.fieldEquals('Vault', vaultAddress, 'capacity', capacity)
      assert.fieldEquals('Vault', vaultAddress, 'tokenName', name)
      assert.fieldEquals('Vault', vaultAddress, 'mevEscrow', mevEscrowAddress)
      assert.fieldEquals('Vault', vaultAddress, 'feePercent', feePercent)
      assert.fieldEquals('Vault', vaultAddress, 'tokenSymbol', symbol)
      assert.fieldEquals('Vault', vaultAddress, 'feeRecipient', adminAddress)
      assert.fieldEquals('Vault', vaultAddress, 'createdAt', '1')

      assert.fieldEquals('Vault', vaultAddress, 'imageUrl', 'null')
      assert.fieldEquals('Vault', vaultAddress, 'displayName', 'null')
      assert.fieldEquals('Vault', vaultAddress, 'description', 'null')
      assert.fieldEquals('Vault', vaultAddress, 'validatorsRoot', 'null')
      assert.fieldEquals('Vault', vaultAddress, 'metadataIpfsHash', 'null')

      assert.fieldEquals('Vault', vaultAddress, 'allocators', '[]')
      assert.fieldEquals('Vault', vaultAddress, 'checkpoints', '[]')
      assert.fieldEquals('Vault', vaultAddress, 'daySnapshots', '[]')
      assert.fieldEquals('Vault', vaultAddress, 'exitRequests', '[]')
      assert.fieldEquals('Vault', vaultAddress, 'allocatorActions', '[]')

      assert.fieldEquals('Vault', vaultAddress, 'totalShares', '0')
      assert.fieldEquals('Vault', vaultAddress, 'totalAssets', '0')
      assert.fieldEquals('Vault', vaultAddress, 'queuedShares', '0')
      assert.fieldEquals('Vault', vaultAddress, 'unclaimedAssets', '0')
    })

    test('increases vaults count', () => {
      const name = 'name'
      const symbol = 'symbol'
      const capacity = '10000'
      const feePercent = '10'

      const vaultEvent = createVaultEvent(
        address.get('factory'),
        address.get('admin'),
        address.get('vault'),
        address.get('mevEscrow'),
        name,
        symbol,
        capacity,
        feePercent,
      )

      handleVaultCreated(vaultEvent)

      assert.fieldEquals('Network', '0', 'vaultsTotal', '1')
    })
  })
})
