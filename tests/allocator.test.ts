import { describe, test, afterEach, assert, clearStore } from 'matchstick-as'
import { Address, BigInt } from '@graphprotocol/graph-ts'

import { createOrLoadAllocator, isAllocatorInactive } from '../src/entities/allocator'

const VAULT = Address.fromString('0x0000000000000000000000000000000000000AAA')
const USER = Address.fromString('0x0000000000000000000000000000000000000001')

describe('allocator', () => {
  afterEach(() => {
    clearStore()
  })

  describe('isAllocatorInactive', () => {
    test('is true for a freshly created allocator', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      assert.assertTrue(isAllocatorInactive(allocator))
    })

    test('is false when allocator has shares', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.shares = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))
    })

    test('is false when allocator has exiting assets', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.exitingAssets = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))
    })

    test('is false when allocator has minted OsToken shares', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.mintedOsTokenShares = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))
    })

    test('is false when allocator has extra boost OsToken shares', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.extraBoostOsTokenShares = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))
    })

    test('is false when allocator has period earnings', () => {
      let allocator = createOrLoadAllocator(USER, VAULT)
      allocator._periodStakeEarnedAssets = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))

      allocator = createOrLoadAllocator(USER, VAULT)
      allocator._periodBoostEarnedAssets = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))

      allocator = createOrLoadAllocator(USER, VAULT)
      allocator._periodBoostEarnedOsTokenShares = BigInt.fromI32(1)
      assert.assertTrue(!isAllocatorInactive(allocator))

      allocator = createOrLoadAllocator(USER, VAULT)
      allocator._periodOsTokenFeeShares = BigInt.fromI32(-1)
      assert.assertTrue(!isAllocatorInactive(allocator))
    })

    test('is false when allocator is counted as user', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator._countedAsUser = true
      assert.assertTrue(!isAllocatorInactive(allocator))
    })
  })
})
