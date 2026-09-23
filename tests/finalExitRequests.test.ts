import { describe, test, afterEach, assert, clearStore, createMockedFunction, newMockEvent } from 'matchstick-as'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, Network, Vault } from '../generated/schema'
import { Initialized } from '../generated/templates/Vault/Vault'

import {
  getCalculateExitedAssetsCall,
  getExitQueueIndexCall,
  updateClaimableExitRequests,
  updateExitRequests,
} from '../src/entities/exitRequest'
import { getAllocatorId } from '../src/entities/allocator'
import { getUpdateStateCall } from '../src/entities/vault'
import { handleInitialized } from '../src/mappings/vault'
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

function createVault(): Vault {
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
  vault.save()
  return vault
}

function createExitRequest(positionTicket: i32): ExitRequest {
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
  exitRequest.save()
  return exitRequest
}

// the exit request that is excluded from the syncs: a contract call for it would not match the mocked multicalls
function createFinalExitRequest(positionTicket: i32): ExitRequest {
  const exitRequest = createExitRequest(positionTicket)
  exitRequest.exitedAssets = wad
  exitRequest.isClaimable = true
  exitRequest._isFinal = true
  exitRequest.save()
  return exitRequest
}

function loadRequest(positionTicket: i32): ExitRequest {
  return ExitRequest.load(`${VAULT.toHex()}-${positionTicket.toString()}`)!
}

function mockMulticall(
  calls: Array<ethereum.Value>,
  results: Array<Bytes>,
  updateStateCall: ethereum.Value | null,
): void {
  const encodedResults: Array<ethereum.Value> = []
  if (updateStateCall !== null) {
    // the vault state update is prepended to the calls, its result is ignored
    const prefix: Array<ethereum.Value> = [updateStateCall as ethereum.Value]
    calls = prefix.concat(calls)
    const result: Array<ethereum.Value> = [ethereum.Value.fromBoolean(true), ethereum.Value.fromBytes(new Bytes(0))]
    encodedResults.push(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(result)))
  }
  for (let i = 0; i < results.length; i++) {
    const result: Array<ethereum.Value> = [ethereum.Value.fromBoolean(true), ethereum.Value.fromBytes(results[i])]
    encodedResults.push(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(result)))
  }
  createMockedFunction(Address.fromString(MULTICALL), 'tryAggregate', tryAggregateSig)
    .withArgs([ethereum.Value.fromBoolean(true), ethereum.Value.fromArray(calls)])
    .returns([ethereum.Value.fromArray(encodedResults)])
}

function encodeExitedAssets(leftTickets: BigInt, exitedAssets: BigInt): Bytes {
  return ethereum
    .encode(ethereum.Value.fromUnsignedBigInt(leftTickets))!
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(wad.minus(leftTickets)))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(exitedAssets))!)
}

// mocks the calculateExitedAssets call that is executed without the simulated vault state update
function mockConfirmation(positionTicket: i32, exitQueueIndex: BigInt, result: Bytes): void {
  const call = encodeContractCall(
    VAULT,
    getCalculateExitedAssetsCall(USER, BigInt.fromI32(positionTicket), ENTER_TIMESTAMP, exitQueueIndex),
  )
  mockMulticall([call], [result], null)
}

// mocks both exit requests update stages, the multicalls must contain the passed position tickets only
function mockExitRequests(
  positionTickets: Array<i32>,
  exitQueueIndex: BigInt,
  leftTickets: Array<BigInt>,
  exitedAssets: Array<BigInt>,
  updateStateCall: ethereum.Value | null = null,
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
    stage2Results.push(encodeExitedAssets(leftTickets[i], exitedAssets[i]))
  }
  mockMulticall(stage1Calls, stage1Results, updateStateCall)
  mockMulticall(stage2Calls, stage2Results, updateStateCall)
}

// the vault with the harvest params: its exit requests are queried on top of the simulated state update
function createHarvestableVault(): Vault {
  const vault = createVault()
  vault.rewardsRoot = Bytes.fromHexString('0x' + '11'.repeat(32))
  vault.proofReward = BigInt.fromI32(1)
  vault.proofUnlockedMevReward = BigInt.zero()
  vault.proof = ['0x' + '22'.repeat(32)]
  vault.save()
  return vault
}

describe('final exit requests', () => {
  afterEach(() => {
    clearStore()
  })

  test('stops syncing the exit request that is fully processed and claimable', () => {
    const vault = createVault()
    createExitRequest(1)
    createExitRequest(2)
    const halfWad = wad.div(BigInt.fromI32(2))
    // the exit requests order is not guaranteed
    mockExitRequests([1, 2], BigInt.fromI32(7), [BigInt.zero(), halfWad], [wad.plus(BigInt.fromI32(5)), halfWad])
    mockExitRequests([2, 1], BigInt.fromI32(7), [halfWad, BigInt.zero()], [halfWad, wad.plus(BigInt.fromI32(5))])

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    const processed = loadRequest(1)
    assert.bigIntEquals(processed.exitedAssets, wad.plus(BigInt.fromI32(5)))
    assert.bigIntEquals(processed.totalAssets, wad.plus(BigInt.fromI32(5)))
    assert.assertTrue(processed.isClaimable)
    assert.assertTrue(processed._isFinal)

    const partial = loadRequest(2)
    assert.bigIntEquals(partial.exitedAssets, halfWad)
    assert.assertTrue(partial.isClaimable)
    assert.assertTrue(!partial._isFinal)

    // only the partial exit request is queried by the next update
    mockExitRequests([2], BigInt.fromI32(7), [halfWad], [halfWad])
    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)
  })

  test('keeps syncing the fully processed exit request until it is claimable', () => {
    const vault = createVault()
    createExitRequest(1)
    mockExitRequests([1], BigInt.fromI32(7), [BigInt.zero()], [wad])

    updateExitRequests(new Network('0'), vault, NOT_CLAIMABLE_TIMESTAMP)
    assert.assertTrue(!loadRequest(1).isClaimable)
    assert.assertTrue(!loadRequest(1)._isFinal)

    // the hourly pass makes it claimable, the next exit requests update marks it final
    updateClaimableExitRequests(vault, CLAIMABLE_TIMESTAMP)
    assert.assertTrue(loadRequest(1).isClaimable)
    assert.assertTrue(!loadRequest(1)._isFinal)

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)
    assert.assertTrue(loadRequest(1)._isFinal)
  })

  test('keeps syncing the fully processed V2 position', () => {
    const vault = createVault()
    const exitRequest = createExitRequest(1)
    exitRequest.isV2Position = true
    exitRequest.save()
    mockExitRequests([1], BigInt.fromI32(7), [BigInt.zero()], [wad])

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    assert.assertTrue(loadRequest(1).isClaimable)
    assert.assertTrue(!loadRequest(1)._isFinal)
  })

  test('does not query the final and claimed exit requests', () => {
    const vault = createVault()
    // the position tickets are not used by the other tests, so their mocks cannot match either
    createFinalExitRequest(11)
    const claimed = createExitRequest(13)
    claimed.isClaimed = true
    claimed.save()
    createExitRequest(12)
    mockExitRequests([12], BigInt.fromI32(8), [wad], [BigInt.zero()])

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    assert.bigIntEquals(loadRequest(11).exitedAssets, wad)
    assert.assertTrue(!loadRequest(12)._isFinal)
  })

  test('marks the exit request final when the vault confirms the simulated result', () => {
    const vault = createHarvestableVault()
    createExitRequest(21)
    mockExitRequests([21], BigInt.fromI32(9), [BigInt.zero()], [wad], getUpdateStateCall(vault))
    mockConfirmation(21, BigInt.fromI32(9), encodeExitedAssets(BigInt.zero(), wad))

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    assert.bigIntEquals(loadRequest(21).exitedAssets, wad)
    assert.assertTrue(loadRequest(21).isClaimable)
    assert.assertTrue(loadRequest(21)._isFinal)
  })

  test('keeps syncing the exit request that is processed only by the simulated state update', () => {
    const vault = createHarvestableVault()
    createExitRequest(22)
    mockExitRequests([22], BigInt.fromI32(9), [BigInt.zero()], [wad], getUpdateStateCall(vault))
    // the checkpoint does not exist in the vault yet
    mockConfirmation(22, BigInt.fromI32(9), encodeExitedAssets(wad, BigInt.zero()))

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    // the simulated values are indexed as before, but the exit request is not final
    assert.bigIntEquals(loadRequest(22).exitedAssets, wad)
    assert.assertTrue(loadRequest(22).isClaimable)
    assert.assertTrue(!loadRequest(22)._isFinal)
  })

  test('keeps syncing the exit request when the vault returns different exited assets', () => {
    const vault = createHarvestableVault()
    createExitRequest(23)
    mockExitRequests([23], BigInt.fromI32(9), [BigInt.zero()], [wad], getUpdateStateCall(vault))
    mockConfirmation(23, BigInt.fromI32(9), encodeExitedAssets(BigInt.zero(), wad.minus(BigInt.fromI32(1))))

    updateExitRequests(new Network('0'), vault, CLAIMABLE_TIMESTAMP)

    assert.assertTrue(!loadRequest(23)._isFinal)
  })

  test('verifies the final exit requests again after the vault upgrade', () => {
    createVault()
    createFinalExitRequest(31)

    const mockEvent = newMockEvent()
    const event = new Initialized(
      VAULT,
      mockEvent.logIndex,
      mockEvent.transactionLogIndex,
      mockEvent.logType,
      mockEvent.block,
      mockEvent.transaction,
      [new ethereum.EventParam('version', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(6)))],
      null,
    )
    handleInitialized(event)

    assert.assertTrue(!loadRequest(31)._isFinal)
  })
})
