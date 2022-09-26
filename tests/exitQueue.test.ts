import { BigInt, store } from '@graphprotocol/graph-ts'
import { afterEach, describe, test, assert, clearStore, beforeAll } from 'matchstick-as'

import { handleCheckpointCreated } from '../src/mappings/exitQueue'

import { createVault } from './util/helpers'
import { address, addressString } from './util/mock'
import { createCheckpointCreatedEvent } from './util/events'


beforeAll(() => {
  createVault()
})

afterEach(() => {
  clearStore()
})

describe('exitQueue', () => {

  describe('handleCheckpointCreated', () => {

    test('creates a new VaultCheckpoint', () => {
      const sharesCounter = '10000'
      const exitedAssets = '10000'

      const checkpointCreatedEvent = createCheckpointCreatedEvent(
        BigInt.fromString(sharesCounter),
        BigInt.fromString(exitedAssets),
        address.get('vault'),
      )

      handleCheckpointCreated(checkpointCreatedEvent)

      const vaultId = addressString.get('vault')
      const checkpointIndex = '0'
      const checkpointId = `${vaultId}-${checkpointIndex}`

      assert.fieldEquals('VaultCheckpoint', checkpointId, 'checkpointIndex', checkpointIndex)
      assert.fieldEquals('VaultCheckpoint', checkpointId, 'sharesCounter', sharesCounter)
      assert.fieldEquals('VaultCheckpoint', checkpointId, 'exitedAssets', exitedAssets)
      assert.fieldEquals('VaultCheckpoint', checkpointId, 'vault', vaultId)

      store.remove('VaultCheckpoint', checkpointId)
    })
  })
})
