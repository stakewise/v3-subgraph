import { describe, test, afterEach, assert, clearStore, createMockedFunction } from 'matchstick-as'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Allocator, OsToken, OsTokenConfig, Vault } from '../generated/schema'

import {
  createOrLoadAllocator,
  decreaseAllocatorMintedOsTokenShares,
  loadAllocator,
  updateAllocatorMintedOsTokenShares,
} from '../src/entities/allocator'
import { encodeContractCall } from '../src/helpers/utils'
import { MULTICALL, WAD } from '../src/helpers/constants'

const VAULT = Address.fromString('0x0000000000000000000000000000000000000AAA')
const USER1 = Address.fromString('0x0000000000000000000000000000000000000001')
const USER2 = Address.fromString('0x0000000000000000000000000000000000000002')

const tryAggregateSig = 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])'
const osTokenPositionsSelector = '0x4ec96b22'
const wad = BigInt.fromString(WAD)

function createVault(): Vault {
  const vault = new Vault(VAULT.toHex())
  vault.isOsTokenEnabled = true
  return vault
}

function createOsToken(): OsToken {
  const osToken = new OsToken('1')
  osToken.totalAssets = wad.times(BigInt.fromI32(105))
  osToken.totalSupply = wad.times(BigInt.fromI32(100))
  return osToken
}

function createOsTokenConfig(): OsTokenConfig {
  const osTokenConfig = new OsTokenConfig('2')
  osTokenConfig.ltvPercent = wad.times(BigInt.fromI32(90)).div(BigInt.fromI32(100))
  osTokenConfig.liqThresholdPercent = wad.times(BigInt.fromI32(92)).div(BigInt.fromI32(100))
  return osTokenConfig
}

function createAllocator(user: Address, mintedOsTokenShares: BigInt): Allocator {
  const allocator = createOrLoadAllocator(user, VAULT)
  allocator.shares = wad.times(BigInt.fromI32(10))
  allocator.assets = wad.times(BigInt.fromI32(10))
  allocator.mintedOsTokenShares = mintedOsTokenShares
  allocator.save()
  return allocator
}

// mocks the multicall that must contain the OsToken positions calls of the passed users only
function mockOsTokenPositions(users: Array<Address>, positions: Array<BigInt>): void {
  const calls: Array<ethereum.Value> = []
  const results: Array<ethereum.Value> = []
  for (let i = 0; i < users.length; i++) {
    const callData = Bytes.fromHexString(osTokenPositionsSelector).concat(
      ethereum.encode(ethereum.Value.fromAddress(users[i]))!,
    )
    calls.push(encodeContractCall(VAULT, callData))

    const result: Array<ethereum.Value> = [
      ethereum.Value.fromBoolean(true),
      ethereum.Value.fromBytes(ethereum.encode(ethereum.Value.fromUnsignedBigInt(positions[i]))!),
    ]
    results.push(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(result)))
  }
  createMockedFunction(Address.fromString(MULTICALL), 'tryAggregate', tryAggregateSig)
    .withArgs([ethereum.Value.fromBoolean(true), ethereum.Value.fromArray(calls)])
    .returns([ethereum.Value.fromArray(results)])
}

describe('updateAllocatorMintedOsTokenShares', () => {
  afterEach(() => {
    clearStore()
  })

  test('does not query the allocators without minted OsToken shares', () => {
    createAllocator(USER1, BigInt.zero())

    // there is no mocked multicall, so any contract call would fail the test
    updateAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), createVault())

    const allocator = loadAllocator(USER1, VAULT)!
    assert.bigIntEquals(allocator.mintedOsTokenShares, BigInt.zero())
    assert.bigIntEquals(allocator._periodOsTokenFeeShares, BigInt.zero())
  })

  test('syncs only the allocators with minted OsToken shares', () => {
    createAllocator(USER1, BigInt.zero())
    createAllocator(USER2, wad)
    mockOsTokenPositions([USER2], [wad.plus(BigInt.fromI32(100))])

    updateAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), createVault())

    const allocator = loadAllocator(USER2, VAULT)!
    assert.bigIntEquals(allocator.mintedOsTokenShares, wad.plus(BigInt.fromI32(100)))
    assert.bigIntEquals(allocator._periodOsTokenFeeShares, BigInt.fromI32(100))
    assert.assertTrue(allocator.ltv.gt(BigDecimal.zero()))
  })

  test('verifies the position once after the minted OsToken shares were zeroed', () => {
    let allocator = createAllocator(USER1, wad)
    // burn exactly the indexed shares: the fee accrued since the last sync stays in the vault
    decreaseAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), allocator, wad)
    allocator.save()
    assert.bigIntEquals(allocator.mintedOsTokenShares, BigInt.zero())
    assert.assertTrue(allocator._isOsTokenPositionSyncRequired)

    mockOsTokenPositions([USER1], [BigInt.fromI32(7)])
    updateAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), createVault())

    allocator = loadAllocator(USER1, VAULT)!
    assert.bigIntEquals(allocator.mintedOsTokenShares, BigInt.fromI32(7))
    assert.bigIntEquals(allocator._periodOsTokenFeeShares, BigInt.fromI32(7))
    assert.assertTrue(!allocator._isOsTokenPositionSyncRequired)
  })

  test('stops querying the position that was verified to be empty', () => {
    let allocator = createAllocator(USER1, wad)
    decreaseAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), allocator, wad.plus(wad))
    allocator.save()
    assert.bigIntEquals(allocator.mintedOsTokenShares, BigInt.zero())

    mockOsTokenPositions([USER1], [BigInt.zero()])
    updateAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), createVault())

    allocator = loadAllocator(USER1, VAULT)!
    assert.bigIntEquals(allocator.mintedOsTokenShares, BigInt.zero())
    // without the flag and the minted shares the allocator is not queried anymore
    assert.assertTrue(!allocator._isOsTokenPositionSyncRequired)
  })

  test('skips only the allocator with the decreased position', () => {
    createAllocator(USER1, wad)
    createAllocator(USER2, wad)
    const decreased = wad.minus(BigInt.fromI32(1))
    const increased = wad.plus(BigInt.fromI32(5))
    // the allocators order is not guaranteed
    mockOsTokenPositions([USER1, USER2], [decreased, increased])
    mockOsTokenPositions([USER2, USER1], [increased, decreased])

    updateAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), createVault())

    assert.bigIntEquals(loadAllocator(USER1, VAULT)!.mintedOsTokenShares, wad)
    assert.bigIntEquals(loadAllocator(USER2, VAULT)!.mintedOsTokenShares, increased)
  })

  test('keeps the partially decreased position without the verification flag', () => {
    const allocator = createAllocator(USER1, wad)
    decreaseAllocatorMintedOsTokenShares(createOsToken(), createOsTokenConfig(), allocator, BigInt.fromI32(1))
    assert.bigIntEquals(allocator.mintedOsTokenShares, wad.minus(BigInt.fromI32(1)))
    assert.assertTrue(!allocator._isOsTokenPositionSyncRequired)
  })
})
