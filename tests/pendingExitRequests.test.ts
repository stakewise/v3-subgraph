import { describe, test, afterEach, assert, clearStore, createMockedFunction } from 'matchstick-as'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, Network, Vault } from '../generated/schema'

import {
  getCalculateExitedAssetsCall,
  getExitQueueIndexCall,
  loadPendingExitRequests,
  updateClaimableExitRequests,
  updateExitRequests,
} from '../src/entities/exitRequest'
import { getAllocatorId } from '../src/entities/allocator'
import { encodeContractCall } from '../src/helpers/utils'
import { MULTICALL, WAD } from '../src/helpers/constants'

const VAULT = Address.fromString('0x0000000000000000000000000000000000000AAA')
const USER = Address.fromString('0x0000000000000000000000000000000000000001')

const tryAggregateSig = 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])'
const wad = BigInt.fromString(WAD)
const ENTER_TIMESTAMP = BigInt.fromI32(1000)
const secondsInDay = 86400
// the exit request is claimable when the claim delay has passed
const CLAIMABLE_TIMESTAMP = ENTER_TIMESTAMP.plus(BigInt.fromI32(10 * secondsInDay))
const NOT_CLAIMABLE_TIMESTAMP = ENTER_TIMESTAMP.plus(BigInt.fromI32(3600))

function createVault(isIndexed: boolean): Vault {
  const vault = new Vault(VAULT.toHex())
  vault.factory = VAULT
  vault.admin = USER
  vault.capacity = BigInt.zero()
  vault.feePercent = 0
  vault.feeRecipient = USER
  vault.depositDataManager = USER
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.canHarvest = false
  vault.subVaultsCount = 0
  vault.parentMetaVaults = []
  vault.totalShares = wad.times(BigInt.fromI32(100))
  vault.queuedShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = wad.times(BigInt.fromI32(110))
  vault.rate = wad
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = false
  vault.isErc20 = false
  vault.isOsTokenEnabled = true
  vault.isMetaVault = false
  vault.isCollateralized = true
  vault.isStateUpdateRequired = false
  vault.addressString = VAULT.toHex()
  vault.createdAt = BigInt.zero()
  vault.version = BigInt.fromI32(5)
  vault.osTokenConfig = '2'
  vault.isGenesis = false
  vault.apy = BigDecimal.zero()
  vault.baseApy = BigDecimal.zero()
  vault.extraApy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault._periodEarnedAssets = BigInt.zero()
  if (isIndexed) {
    vault._isPendingExitRequestsIndexed = true
  }
  vault.save()
  return vault
}

function createExitRequest(positionTicket: i32, isPending: boolean): ExitRequest {
  const exitRequest = new ExitRequest(`${VAULT.toHex()}-${positionTicket.toString()}`)
  exitRequest.vault = VAULT.toHex()
  exitRequest.owner = USER
  exitRequest.receiver = USER
  exitRequest.allocator = getAllocatorId(USER, VAULT)
  exitRequest.positionTicket = BigInt.fromI32(positionTicket)
  exitRequest.isV2Position = false
  exitRequest.totalTickets = wad
  exitRequest.totalAssets = wad
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.timestamp = ENTER_TIMESTAMP
  exitRequest.isClaimable = false
  exitRequest.isClaimed = false
  if (isPending) {
    exitRequest._pendingVault = VAULT.toHex()
  }
  exitRequest.save()
  return exitRequest
}

function loadRequest(positionTicket: i32): ExitRequest {
  return ExitRequest.load(`${VAULT.toHex()}-${positionTicket.toString()}`)!
}

function mockMulticall(calls: Array<ethereum.Value>, results: Array<Bytes>): void {
  const encodedResults: Array<ethereum.Value> = []
  for (let i = 0; i < results.length; i++) {
    const result: Array<ethereum.Value> = [ethereum.Value.fromBoolean(true), ethereum.Value.fromBytes(results[i])]
    encodedResults.push(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(result)))
  }
  createMockedFunction(Address.fromString(MULTICALL), 'tryAggregate', tryAggregateSig)
    .withArgs([ethereum.Value.fromBoolean(true), ethereum.Value.fromArray(calls)])
    .returns([ethereum.Value.fromArray(encodedResults)])
}

// mocks both exit requests update stages, the multicalls must contain the passed position tickets only
function mockExitRequests(
  positionTickets: Array<i32>,
  exitQueueIndex: BigInt,
  leftTickets: Array<BigInt>,
  exitedAssets: Array<BigInt>,
): void {
  const stage1Calls: Array<ethereum.Value> = []
  const stage1Results: Array<Bytes> = []
  const stage2Calls: Array<ethereum.Value> = []
  const stage2Results: Array<Bytes> = []
  for (let i = 0; i < positionTickets.length; i++) {
    const positionTicket = BigInt.fromI32(positionTickets[i])
    stage1Calls.push(encodeContractCall(VAULT, getExitQueueIndexCall(positionTicket)))
    stage1Results.push(ethereum.encode(ethereum.Value.fromSignedBigInt(exitQueueIndex))!)

    stage2Calls.push(
      encodeContractCall(VAULT, getCalculateExitedAssetsCall(USER, positionTicket, ENTER_TIMESTAMP, exitQueueIndex)),
    )
    const exitedTickets = wad.minus(leftTickets[i])
    stage2Results.push(
      ethereum
        .encode(ethereum.Value.fromUnsignedBigInt(leftTickets[i]))!
        .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(exitedTickets))!)
        .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(exitedAssets[i]))!),
    )
  }
  mockMulticall(stage1Calls, stage1Results)
  mockMulticall(stage2Calls, stage2Results)
}

describe('pending exit requests', () => {
  afterEach(() => {
    clearStore()
  })

  test('indexes the unclaimed exit requests of the vault once', () => {
    const vault = createVault(false)
    createExitRequest(1, false)
    const claimed = createExitRequest(2, false)
    claimed.isClaimed = true
    claimed.save()

    let pending = loadPendingExitRequests(vault)
    assert.i32Equals(pending.length, 1)
    assert.stringEquals(pending[0].id, loadRequest(1).id)
    assert.stringEquals(loadRequest(1)._pendingVault!, VAULT.toHex())
    assert.assertNull(loadRequest(2)._pendingVault)
    assert.assertTrue(Vault.load(VAULT.toHex())!._isPendingExitRequestsIndexed)

    // the indexed vault reads only the pending exit requests
    createExitRequest(3, false)
    pending = loadPendingExitRequests(vault)
    assert.i32Equals(pending.length, 1)
  })

  test('stops syncing the exit request that is fully processed and claimable', () => {
    const vault = createVault(true)
    createExitRequest(1, true)
    createExitRequest(2, true)
    const halfWad = wad.div(BigInt.fromI32(2))
    // the exit requests order is not guaranteed
    mockExitRequests([1, 2], BigInt.fromI32(7), [BigInt.zero(), halfWad], [wad.plus(BigInt.fromI32(5)), halfWad])
    mockExitRequests([2, 1], BigInt.fromI32(7), [halfWad, BigInt.zero()], [halfWad, wad.plus(BigInt.fromI32(5))])

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    const processed = loadRequest(1)
    assert.bigIntEquals(processed.exitedAssets, wad.plus(BigInt.fromI32(5)))
    assert.bigIntEquals(processed.totalAssets, wad.plus(BigInt.fromI32(5)))
    assert.assertTrue(processed.isClaimable)
    assert.assertNull(processed._pendingVault)

    const partial = loadRequest(2)
    assert.bigIntEquals(partial.exitedAssets, halfWad)
    assert.assertTrue(partial.isClaimable)
    assert.stringEquals(partial._pendingVault!, VAULT.toHex())

    const pending = loadPendingExitRequests(vault)
    assert.i32Equals(pending.length, 1)
    assert.stringEquals(pending[0].id, partial.id)
  })

  test('keeps syncing the fully processed exit request until it is claimable', () => {
    const vault = createVault(true)
    createExitRequest(1, true)
    mockExitRequests([1], BigInt.fromI32(7), [BigInt.zero()], [wad])

    updateExitRequests(new Network('0'), vault, NOT_CLAIMABLE_TIMESTAMP)
    assert.assertTrue(!loadRequest(1).isClaimable)
    assert.stringEquals(loadRequest(1)._pendingVault!, VAULT.toHex())

    // the hourly pass makes it claimable, the next exit requests update drops it from the index
    updateClaimableExitRequests(vault, CLAIMABLE_TIMESTAMP)
    assert.assertTrue(loadRequest(1).isClaimable)
    assert.stringEquals(loadRequest(1)._pendingVault!, VAULT.toHex())

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)
    assert.assertNull(loadRequest(1)._pendingVault)
  })

  test('keeps syncing the fully processed V2 position', () => {
    const vault = createVault(true)
    const exitRequest = createExitRequest(1, true)
    exitRequest.isV2Position = true
    exitRequest.save()
    mockExitRequests([1], BigInt.fromI32(7), [BigInt.zero()], [wad])

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    assert.assertTrue(loadRequest(1).isClaimable)
    assert.stringEquals(loadRequest(1)._pendingVault!, VAULT.toHex())
  })

  test('does not query the exit requests that are out of the index', () => {
    const vault = createVault(true)
    // the final exit request: a contract call for it would not match the mocked multicalls
    const finalRequest = createExitRequest(1, false)
    finalRequest.exitedAssets = wad
    finalRequest.isClaimable = true
    finalRequest.save()
    createExitRequest(2, true)
    mockExitRequests([2], BigInt.fromI32(7), [wad], [BigInt.zero()])

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    assert.bigIntEquals(loadRequest(1).exitedAssets, wad)
    assert.stringEquals(loadRequest(2)._pendingVault!, VAULT.toHex())
  })
})
