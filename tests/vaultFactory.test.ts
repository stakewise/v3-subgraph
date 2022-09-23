import { afterEach, describe, test, assert, clearStore } from 'matchstick-as'

import { Vault } from '../generated/schema'
import { handleVaultCreated } from '../src/mappings/vaultFactory'

import { createVaultEvent } from './util/events'
import { address, addressString } from './util/mock'


afterEach(() => {
  clearStore()
})

describe('vaultFactory', () => {

  describe('handleVaultCreated', () => {

    test('creates a new Vault', () => {
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

      const vaultId = addressString.get('vault')

      assert.fieldEquals('Vault', vaultId, 'feesEscrow',  addressString.get('feesEscrow'))
      assert.fieldEquals('Vault', vaultId, 'operator', addressString.get('operator'))
      assert.fieldEquals('Vault', vaultId, 'maxTotalAssets', '10000')
      assert.fieldEquals('Vault', vaultId, 'feePercent', '10')
      assert.fieldEquals('Vault', vaultId, 'queuedShares', '0')
      assert.fieldEquals('Vault', vaultId, 'claimedAssets', '0')
      assert.fieldEquals('Vault', vaultId, 'withdrawnShares', '0')
    })
  })
})
