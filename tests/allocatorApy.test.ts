import { describe, test, afterEach, assert, clearStore } from 'matchstick-as'
import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { Aave, LeverageStrategyPosition, OsToken, OsTokenConfig, Vault } from '../generated/schema'

import { createOrLoadAllocator, getAllocatorApy, getAllocatorApyWithBoostPosition } from '../src/entities/allocator'
import { createOrLoadAavePosition } from '../src/entities/aave'
import { WAD } from '../src/helpers/constants'

const VAULT = Address.fromString('0x0000000000000000000000000000000000000AAA')
const USER = Address.fromString('0x0000000000000000000000000000000000000001')
const PROXY = Address.fromString('0x0000000000000000000000000000000000000002')

const wad = BigInt.fromString(WAD)

function createVault(isOsTokenEnabled: boolean): Vault {
  const vault = new Vault(VAULT.toHex())
  vault.isOsTokenEnabled = isOsTokenEnabled
  vault.apy = BigDecimal.fromString('3.5')
  vault.allocatorMaxBoostApy = BigDecimal.fromString('10')
  return vault
}

function createOsToken(): OsToken {
  const osToken = new OsToken('1')
  osToken.feePercent = 500
  osToken.apy = BigDecimal.fromString('3')
  osToken.totalAssets = wad.times(BigInt.fromI32(105))
  osToken.totalSupply = wad.times(BigInt.fromI32(100))
  return osToken
}

function createOsTokenConfig(): OsTokenConfig {
  const osTokenConfig = new OsTokenConfig('2')
  osTokenConfig.ltvPercent = wad.times(BigInt.fromI32(9)).div(BigInt.fromI32(10))
  return osTokenConfig
}

function createAave(): Aave {
  const aave = new Aave('1')
  aave.borrowApy = BigDecimal.fromString('2')
  return aave
}

function createBoostPosition(): LeverageStrategyPosition {
  // the leverage strategy proxy stakes to the vault and borrows from Aave
  const proxyAllocator = createOrLoadAllocator(PROXY, VAULT)
  proxyAllocator.assets = wad.times(BigInt.fromI32(50))
  proxyAllocator.mintedOsTokenShares = wad.times(BigInt.fromI32(40))
  proxyAllocator.save()

  const aavePosition = createOrLoadAavePosition(PROXY)
  aavePosition.borrowedAssets = wad.times(BigInt.fromI32(38))
  aavePosition.save()

  const position = new LeverageStrategyPosition(`${VAULT.toHex()}-${USER.toHex()}`)
  position.proxy = PROXY
  position.user = USER
  position.vault = VAULT.toHex()
  position.osTokenShares = wad.times(BigInt.fromI32(12))
  position.assets = BigInt.zero()
  position.borrowLtv = BigDecimal.zero()
  position.exitingPercent = BigInt.zero()
  position.exitingOsTokenShares = BigInt.zero()
  position.exitingAssets = BigInt.zero()
  position.version = BigInt.fromI32(1)
  position.save()
  return position
}

describe('allocator APY', () => {
  afterEach(() => {
    clearStore()
  })

  test('is the vault APY or zero in a vault without OsToken', () => {
    const vault = createVault(false)
    const allocator = createOrLoadAllocator(USER, VAULT)
    assert.stringEquals(
      getAllocatorApy(createAave(), createOsToken(), createOsTokenConfig(), vault, allocator).toString(),
      '0',
    )

    allocator.assets = wad
    assert.stringEquals(
      getAllocatorApy(createAave(), createOsToken(), createOsTokenConfig(), vault, allocator).toString(),
      '3.5',
    )
  })

  test('ignores the boost position in a vault without OsToken', () => {
    const vault = createVault(false)
    const allocator = createOrLoadAllocator(USER, VAULT)
    allocator.assets = wad
    const position = createBoostPosition()

    assert.stringEquals(
      getAllocatorApyWithBoostPosition(
        createAave(),
        createOsToken(),
        createOsTokenConfig(),
        vault,
        allocator,
        position,
      ).toString(),
      '3.5',
    )
  })

  test('is the same with the passed and the loaded boost position', () => {
    const vault = createVault(true)
    const allocator = createOrLoadAllocator(USER, VAULT)
    allocator.assets = wad.times(BigInt.fromI32(10))
    allocator.mintedOsTokenShares = wad.times(BigInt.fromI32(8))

    const withoutBoostApy = getAllocatorApy(createAave(), createOsToken(), createOsTokenConfig(), vault, allocator)
    assert.stringEquals(
      getAllocatorApyWithBoostPosition(
        createAave(),
        createOsToken(),
        createOsTokenConfig(),
        vault,
        allocator,
        null,
      ).toString(),
      withoutBoostApy.toString(),
    )

    const position = createBoostPosition()
    const loadedBoostApy = getAllocatorApy(createAave(), createOsToken(), createOsTokenConfig(), vault, allocator)
    assert.assertTrue(!loadedBoostApy.equals(withoutBoostApy))
    assert.stringEquals(
      getAllocatorApyWithBoostPosition(
        createAave(),
        createOsToken(),
        createOsTokenConfig(),
        vault,
        allocator,
        position,
      ).toString(),
      loadedBoostApy.toString(),
    )
  })
})
