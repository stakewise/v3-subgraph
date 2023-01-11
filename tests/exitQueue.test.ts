import { BigInt } from '@graphprotocol/graph-ts'
import { afterEach, describe, test, assert, clearStore, beforeAll } from 'matchstick-as'

import { handleCheckpointCreated } from '../src/mappings/exitQueue'

import { createVault } from './util/helpers'
import { addressString } from './util/mock'
import { createCheckpointCreatedEvent } from './util/events'


const resetStore = (): void => {
  clearStore()
  createVault()
}

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
      )

      handleCheckpointCreated(checkpointCreatedEvent)

      const index = '0'
      const vaultId = addressString.get('vault')
      const checkpointId = `${vaultId}-${index}`

      assert.fieldEquals('VaultCheckpoint', checkpointId, 'index', index)
      assert.fieldEquals('VaultCheckpoint', checkpointId, 'sharesCounter', sharesCounter)
      assert.fieldEquals('VaultCheckpoint', checkpointId, 'exitedAssets', exitedAssets)
      assert.fieldEquals('VaultCheckpoint', checkpointId, 'vault', vaultId)

      resetStore()
    })
  })
})
