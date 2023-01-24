import { afterAll, afterEach, assert, beforeAll, clearStore, describe, test } from 'matchstick-as'
import { handleWhitelistUpdated } from '../src/mappings/privateVault'
import { PrivateVaultAccount } from '../generated/schema'

import { createVault } from './util/helpers'
import { addressString } from './util/mock'
import { createWhitelistUpdatedEvent } from './util/events'


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

describe('privateVault', () => {

  describe('handleWhitelistUpdated', () => {

    test('creates PrivateVaultAccount', () => {
      const vaultAddress = addressString.get('vault')
      const accountAddress = addressString.get('admin')

      const whitelistUpdatedEvent = createWhitelistUpdatedEvent(
        accountAddress,
        true
      )

      handleWhitelistUpdated(whitelistUpdatedEvent)

      const privateVaultAccountId = `${vaultAddress}-${accountAddress}`

      assert.fieldEquals('PrivateVaultAccount', privateVaultAccountId, 'address', accountAddress)
      assert.fieldEquals('PrivateVaultAccount', privateVaultAccountId, 'vault', vaultAddress)
    })

    test('removes PrivateVaultAccount', () => {
      const vaultAddress = addressString.get('vault')
      const accountAddress = addressString.get('admin')

      const whitelistUpdatedEvent = createWhitelistUpdatedEvent(
        accountAddress,
        true
      )

      const whitelistRemovedEvent = createWhitelistUpdatedEvent(
        accountAddress,
        false
      )

      handleWhitelistUpdated(whitelistUpdatedEvent)
      handleWhitelistUpdated(whitelistRemovedEvent)

      const privateVaultAccountId = `${vaultAddress}-${accountAddress}`

      assert.notInStore('PrivateVaultAccount', privateVaultAccountId)
    })
  })
})
