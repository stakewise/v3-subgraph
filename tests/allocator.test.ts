import { describe, test, afterEach, assert, clearStore } from 'matchstick-as'
import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { LeverageStrategyPosition } from '../generated/schema'

import { ALLOCATOR_DUST_ASSETS, createOrLoadAllocator, isAllocatorInactive } from '../src/entities/allocator'

const VAULT = Address.fromString('0x0000000000000000000000000000000000000AAA')
const USER = Address.fromString('0x0000000000000000000000000000000000000001')
const one = BigInt.fromI32(1)

function createBoostPosition(): LeverageStrategyPosition {
  const position = new LeverageStrategyPosition(`${VAULT.toHex()}-${USER.toHex()}`)
  position.proxy = USER
  position.user = USER
  position.vault = VAULT.toHex()
  position.osTokenShares = BigInt.zero()
  position.assets = BigInt.zero()
  position.borrowLtv = BigDecimal.zero()
  position.exitingPercent = BigInt.zero()
  position.exitingOsTokenShares = BigInt.zero()
  position.exitingAssets = BigInt.zero()
  position.version = BigInt.fromI32(1)
  return position
}

describe('allocator', () => {
  afterEach(() => {
    clearStore()
  })

  describe('isAllocatorInactive', () => {
    test('is true for a freshly created allocator', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      assert.assertTrue(isAllocatorInactive(allocator, BigInt.zero(), null))
    })

    test('is true for the position below the dust threshold', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.shares = one
      allocator.assets = ALLOCATOR_DUST_ASSETS.minus(one)
      allocator._countedAsUser = true
      assert.assertTrue(isAllocatorInactive(allocator, BigInt.zero(), null))
    })

    test('is false when the position reaches the dust threshold', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.shares = one
      allocator.assets = ALLOCATOR_DUST_ASSETS
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))
    })

    test('counts the exiting and reward splitter assets', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.assets = one
      allocator.exitingAssets = ALLOCATOR_DUST_ASSETS.minus(one)
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))

      allocator.exitingAssets = BigInt.zero()
      assert.assertTrue(!isAllocatorInactive(allocator, ALLOCATOR_DUST_ASSETS.minus(one), null))
      assert.assertTrue(isAllocatorInactive(allocator, ALLOCATOR_DUST_ASSETS.minus(BigInt.fromI32(2)), null))
    })

    test('is false when allocator has OsToken position', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator.mintedOsTokenShares = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))

      allocator.mintedOsTokenShares = BigInt.zero()
      allocator.extraBoostOsTokenShares = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))
    })

    test('is false when allocator has boost position', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      const position = createBoostPosition()
      assert.assertTrue(isAllocatorInactive(allocator, BigInt.zero(), position))

      position.osTokenShares = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), position))
      position.osTokenShares = BigInt.zero()
      position.exitingOsTokenShares = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), position))
      position.exitingOsTokenShares = BigInt.zero()
      position.assets = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), position))
      position.assets = BigInt.zero()
      position.exitingAssets = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), position))
    })

    test('is false when something accrued for the period', () => {
      const allocator = createOrLoadAllocator(USER, VAULT)
      allocator._periodStakeEarnedAssets = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))

      allocator._periodStakeEarnedAssets = BigInt.zero()
      allocator._periodBoostEarnedAssets = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))

      allocator._periodBoostEarnedAssets = BigInt.zero()
      allocator._periodBoostEarnedOsTokenShares = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))

      allocator._periodBoostEarnedOsTokenShares = BigInt.zero()
      allocator._periodOsTokenFeeShares = one
      assert.assertTrue(!isAllocatorInactive(allocator, BigInt.zero(), null))
    })
  })
})
