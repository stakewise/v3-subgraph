import { describe, test, afterEach, assert, clearStore, createMockedFunction, newMockEvent } from 'matchstick-as'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExitRequest, Network, OsToken, OsTokenConfig, SubVault, Vault } from '../generated/schema'

import {
  encodeAggregateCall,
  encodeClaimSubVaultsExitedAssetsCall,
  harvestSubVaults,
  loadSimulatedSubVaults,
  simulateMetaVaultUpdateState,
} from '../src/entities/metaVault'
import { createOrLoadAllocator, getAllocatorId } from '../src/entities/allocator'
import {
  encodeUpdateStateCall,
  exitQueueDataSelector,
  getConvertToAssetsCall,
  getSharesCall,
  getUpdateStateCall,
  totalAssetsSelector,
  totalSharesSelector,
} from '../src/entities/vault'
import { getCalculateExitedAssetsCall, getExitQueueIndexCall } from '../src/entities/exitRequest'
import { CheckpointType, createOrLoadCheckpoint } from '../src/entities/checkpoint'
import { syncVaults } from '../src/mappings/vault'
import { encodeContractCall } from '../src/helpers/utils'
import { MULTICALL, WAD } from '../src/helpers/constants'

const META_VAULT = Address.fromString('0x0000000000000000000000000000000000000AAA')
const REGISTRY = Address.fromString('0x0000000000000000000000000000000000000BBB')
const SUB_VAULT1 = Address.fromString('0x0000000000000000000000000000000000000C01')
const SUB_VAULT2 = Address.fromString('0x0000000000000000000000000000000000000C02')
const FEE_RECIPIENT = Address.fromString('0x0000000000000000000000000000000000000001')
const USER = Address.fromString('0x0000000000000000000000000000000000000002')

const tryAggregateSig = 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])'
const wad = BigInt.fromString(WAD)
const TIMESTAMP = BigInt.fromI32(1000000)
const ENTER_TIMESTAMP = BigInt.fromI32(1000)
const REWARDS_ROOT = Bytes.fromHexString('0x1111111111111111111111111111111111111111111111111111111111111111')

const NEW_RATE = wad.plus(BigInt.fromI32(100))
const NEW_TOTAL_ASSETS = wad.times(BigInt.fromI32(101))
const NEW_TOTAL_SHARES = wad.times(BigInt.fromI32(100))
const CLAIMED_ASSETS = wad.times(BigInt.fromI32(5))
const SUB_VAULTS_ASSETS_BEFORE = wad.times(BigInt.fromI32(100))
// the claimed assets are deducted from the sub vaults total assets, 1 ETH is earned
const SUB_VAULTS_ASSETS_AFTER = SUB_VAULTS_ASSETS_BEFORE.minus(CLAIMED_ASSETS).plus(wad)

function createVault(address: Address, isMetaVault: boolean): Vault {
  const vault = new Vault(address.toHex())
  vault.factory = address
  vault.admin = FEE_RECIPIENT
  vault.capacity = BigInt.zero()
  vault.feePercent = 0
  vault.feeRecipient = FEE_RECIPIENT
  vault.depositDataManager = FEE_RECIPIENT
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
  vault.totalAssets = wad.times(BigInt.fromI32(100))
  vault.rate = wad
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = false
  vault.isErc20 = false
  vault.isOsTokenEnabled = true
  vault.isMetaVault = isMetaVault
  vault.isCollateralized = true
  vault.isStateUpdateRequired = false
  vault.addressString = address.toHex()
  vault.createdAt = BigInt.zero()
  vault.version = BigInt.fromI32(6)
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

function createSubVault(address: Address, canHarvest: boolean): Vault {
  const vault = createVault(address, false)
  vault.canHarvest = canHarvest
  vault.rewardsRoot = REWARDS_ROOT
  vault.proofReward = BigInt.fromI32(1)
  vault.proofUnlockedMevReward = BigInt.zero()
  vault.proof = ['0x' + '22'.repeat(32)]
  vault.save()

  const subVault = new SubVault(`${META_VAULT.toHex()}-${address.toHex()}`)
  subVault.metaVault = META_VAULT.toHex()
  subVault.subVault = address.toHex()
  subVault.save()
  return vault
}

function createMetaVault(): Vault {
  const vault = createVault(META_VAULT, true)
  vault.subVaultsRegistry = REGISTRY
  vault.subVaultsCount = 2
  vault.save()
  return vault
}

function createNetwork(): Network {
  const network = new Network('0')
  network.factoriesInitialized = true
  network.totalAssets = BigInt.zero()
  network.totalEarnedAssets = BigInt.zero()
  network.vaultsCount = 0
  network.collateralizedVaultsCount = 0
  network.vaultIds = []
  network.osTokenVaultIds = []
  network.oraclesConfigIpfsHash = ''
  network.usersCount = 0
  network.save()
  return network
}

function createOsToken(): OsToken {
  const osToken = new OsToken('1')
  osToken.apy = BigDecimal.zero()
  osToken.apys = []
  osToken.feePercent = 0
  osToken.totalAssets = wad.times(BigInt.fromI32(105))
  osToken.totalSupply = wad.times(BigInt.fromI32(100))
  osToken.save()

  const osTokenConfig = new OsTokenConfig('2')
  osTokenConfig.ltvPercent = wad.times(BigInt.fromI32(90)).div(BigInt.fromI32(100))
  osTokenConfig.leverageMaxMintLtvPercent = osTokenConfig.ltvPercent
  osTokenConfig.liqThresholdPercent = wad.times(BigInt.fromI32(92)).div(BigInt.fromI32(100))
  osTokenConfig.save()
  return osToken
}

// creates the exit request of the meta vault in the sub vault
function createExitRequest(subVault: Address, positionTicket: i32, exitQueueIndex: i32, isClaimable: boolean): void {
  createUserExitRequest(subVault, META_VAULT, positionTicket, exitQueueIndex, isClaimable)
}

function createUserExitRequest(
  vault: Address,
  owner: Address,
  positionTicket: i32,
  exitQueueIndex: i32,
  isClaimable: boolean,
): void {
  createOrLoadAllocator(owner, vault).save()
  const exitRequest = new ExitRequest(`${vault.toHex()}-${positionTicket.toString()}`)
  exitRequest.vault = vault.toHex()
  exitRequest.owner = owner
  exitRequest.receiver = owner
  exitRequest.allocator = getAllocatorId(owner, vault)
  exitRequest.positionTicket = BigInt.fromI32(positionTicket)
  exitRequest.isV2Position = false
  exitRequest.totalTickets = wad
  exitRequest.totalAssets = CLAIMED_ASSETS
  exitRequest.exitedAssets = exitQueueIndex >= 0 ? CLAIMED_ASSETS : BigInt.zero()
  exitRequest.exitQueueIndex = exitQueueIndex >= 0 ? BigInt.fromI32(exitQueueIndex) : null
  exitRequest.timestamp = ENTER_TIMESTAMP
  exitRequest.isClaimable = isClaimable
  exitRequest.isClaimed = false
  exitRequest.save()
}

function uint256(value: BigInt): Bytes {
  return ethereum.encode(ethereum.Value.fromUnsignedBigInt(value))!
}

function callResult(success: boolean, data: Bytes): ethereum.Value {
  const result: Array<ethereum.Value> = [ethereum.Value.fromBoolean(success), ethereum.Value.fromBytes(data)]
  return ethereum.Value.fromTuple(changetype<ethereum.Tuple>(result))
}

function stateCalls(): Array<ethereum.Value> {
  return [
    encodeContractCall(META_VAULT, getConvertToAssetsCall(wad)),
    encodeContractCall(META_VAULT, Bytes.fromHexString(totalAssetsSelector)),
    encodeContractCall(META_VAULT, Bytes.fromHexString(totalSharesSelector)),
    encodeContractCall(META_VAULT, Bytes.fromHexString(exitQueueDataSelector)),
    encodeContractCall(META_VAULT, getSharesCall(FEE_RECIPIENT)),
  ]
}

function stateResults(rate: BigInt, totalAssets: BigInt): Array<ethereum.Value> {
  const exitQueueData = uint256(BigInt.zero())
    .concat(uint256(BigInt.zero()))
    .concat(uint256(BigInt.zero()))
    .concat(uint256(BigInt.zero()))
    .concat(uint256(BigInt.zero()))
  return [
    callResult(true, uint256(rate)),
    callResult(true, uint256(totalAssets)),
    callResult(true, uint256(NEW_TOTAL_SHARES)),
    callResult(true, exitQueueData),
    callResult(true, uint256(BigInt.zero())),
  ]
}

function encodeMetaVaultUpdateStateCall(): ethereum.Value {
  return encodeUpdateStateCall(
    META_VAULT,
    Bytes.fromUint8Array(new Uint8Array(32)),
    BigInt.zero(),
    BigInt.zero(),
    new Array<Bytes>(),
  )
}

// mocks the simulation multicall: sub vaults total assets, the simulated calls, the state reads, sub vaults total assets
function mockSimulation(
  simulatedCalls: Array<ethereum.Value>,
  success: boolean,
  assetsBefore: BigInt,
  assetsAfter: BigInt,
): void {
  const subVaultsTotalAssetsCall = encodeContractCall(REGISTRY, Bytes.fromHexString('0x829e6cab'))
  const aggregateCall = encodeAggregateCall(simulatedCalls)
  const calls: Array<ethereum.Value> = [subVaultsTotalAssetsCall, aggregateCall]
  const results: Array<ethereum.Value> = [callResult(true, uint256(assetsBefore)), callResult(success, new Bytes(0))]
  createMockedFunction(Address.fromString(MULTICALL), 'tryAggregate', tryAggregateSig)
    .withArgs([
      ethereum.Value.fromBoolean(false),
      ethereum.Value.fromArray(calls.concat(stateCalls()).concat([subVaultsTotalAssetsCall])),
    ])
    .returns([
      ethereum.Value.fromArray(
        results.concat(stateResults(NEW_RATE, NEW_TOTAL_ASSETS)).concat([callResult(true, uint256(assetsAfter))]),
      ),
    ])
}

function mockHarvest(): void {
  createMockedFunction(Address.fromString(MULTICALL), 'tryAggregate', tryAggregateSig)
    .withArgs([ethereum.Value.fromBoolean(true), ethereum.Value.fromArray(stateCalls())])
    .returns([ethereum.Value.fromArray(stateResults(NEW_RATE, NEW_TOTAL_ASSETS))])
  createMockedFunction(REGISTRY, 'canUpdateState', 'canUpdateState():(bool)').returns([
    ethereum.Value.fromBoolean(false),
  ])
}

// the sub vault 1 is harvested and has the claimable exit request, the sub vault 2 is already harvested
function setupSimulation(): Array<ethereum.Value> {
  createNetwork()
  createOsToken()
  createMetaVault()
  const subVault1 = createSubVault(SUB_VAULT1, true)
  createSubVault(SUB_VAULT2, false)
  createExitRequest(SUB_VAULT1, 10, 3, true)
  // not processed yet, not claimed
  createExitRequest(SUB_VAULT1, 20, -1, false)

  const exitRequest = ExitRequest.load(`${SUB_VAULT1.toHex()}-10`)!
  return [
    getUpdateStateCall(subVault1)!,
    encodeClaimSubVaultsExitedAssetsCall(REGISTRY, [exitRequest]),
    encodeMetaVaultUpdateStateCall(),
  ]
}

function simulate(): boolean {
  const vault = Vault.load(META_VAULT.toHex())!
  return simulateMetaVaultUpdateState(
    Network.load('0')!,
    OsToken.load('1')!,
    vault,
    loadSimulatedSubVaults(vault)!,
    TIMESTAMP,
  )
}

// mocks the multicall executed on top of the vault state update call, if any
function mockMulticall(
  updateStateCall: ethereum.Value | null,
  calls: Array<ethereum.Value>,
  results: Array<Bytes>,
): void {
  const prefix: Array<ethereum.Value> = []
  const encodedResults: Array<ethereum.Value> = []
  if (updateStateCall !== null) {
    prefix.push(updateStateCall)
    encodedResults.push(callResult(true, new Bytes(0)))
  }
  for (let i = 0; i < results.length; i++) {
    encodedResults.push(callResult(true, results[i]))
  }
  createMockedFunction(Address.fromString(MULTICALL), 'tryAggregate', tryAggregateSig)
    .withArgs([ethereum.Value.fromBoolean(true), ethereum.Value.fromArray(prefix.concat(calls))])
    .returns([ethereum.Value.fromArray(encodedResults)])
}

// mocks the exit request update: the exit queue index and the exited assets queries
function mockExitRequestUpdate(
  updateStateCall: ethereum.Value | null,
  vault: Address,
  receiver: Address,
  positionTicket: BigInt,
  exitQueueIndex: BigInt,
  leftTickets: BigInt,
  exitedAssets: BigInt,
): void {
  mockMulticall(
    updateStateCall,
    [encodeContractCall(vault, getExitQueueIndexCall(positionTicket))],
    [ethereum.encode(ethereum.Value.fromSignedBigInt(exitQueueIndex))!],
  )
  // the unprocessed exit request is queried with the max exit queue index
  const queriedExitQueueIndex = exitQueueIndex.lt(BigInt.zero())
    ? BigInt.fromI32(2).pow(255).minus(BigInt.fromI32(1))
    : exitQueueIndex
  mockMulticall(
    updateStateCall,
    [
      encodeContractCall(
        vault,
        getCalculateExitedAssetsCall(receiver, positionTicket, ENTER_TIMESTAMP, queriedExitQueueIndex),
      ),
    ],
    [
      uint256(leftTickets)
        .concat(uint256(wad.minus(leftTickets)))
        .concat(uint256(exitedAssets)),
    ],
  )
}

function setKeeperUpdated(isKeeperUpdated: boolean): ethereum.Block {
  const keeperCheckpoint = createOrLoadCheckpoint(CheckpointType.KEEPER)
  keeperCheckpoint.timestamp = TIMESTAMP
  keeperCheckpoint.save()
  const vaultsCheckpoint = createOrLoadCheckpoint(CheckpointType.VAULTS)
  vaultsCheckpoint.timestamp = isKeeperUpdated ? BigInt.zero() : TIMESTAMP
  vaultsCheckpoint.save()

  const network = Network.load('0')!
  network.vaultIds = [META_VAULT.toHex()]
  network.save()

  const block = newMockEvent().block
  // the hourly sync interval has passed
  block.timestamp = TIMESTAMP.plus(BigInt.fromI32(7200))
  return block
}

describe('meta vault update state simulation', () => {
  afterEach(() => {
    clearStore()
  })

  test('encodes the sub vaults exit requests claim', () => {
    const subVault = Address.fromString('0xabababababababababababababababababababab')
    createExitRequest(subVault, 10, 1, true)
    const exitRequest = ExitRequest.load(`${subVault.toHex()}-10`)!
    exitRequest.timestamp = BigInt.fromI32(1700000000)
    const call = encodeClaimSubVaultsExitedAssetsCall(REGISTRY, [exitRequest]).toTuple()

    assert.addressEquals(call[0].toAddress(), REGISTRY)
    assert.bytesEquals(
      call[1].toBytes(),
      Bytes.fromHexString(
        // selector, offset, length, exit queue index, vault, timestamp
        '0xe620196c000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000abababababababababababababababababababab000000000000000000000000000000000000000000000000000000006553f100',
      ),
    )
  })

  test('applies the simulated state and does not double count the harvest', () => {
    mockSimulation(setupSimulation(), true, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER)

    assert.assertTrue(simulate())

    let vault = Vault.load(META_VAULT.toHex())!
    assert.bigIntEquals(vault.rate, NEW_RATE)
    assert.bigIntEquals(vault.totalAssets, NEW_TOTAL_ASSETS)
    assert.bigIntEquals(vault.totalShares, NEW_TOTAL_SHARES)
    assert.bytesEquals(vault.rewardsRoot!, REWARDS_ROOT)
    assert.bigIntEquals(vault._periodEarnedAssets, wad)
    assert.bigIntEquals(vault._simulatedSubVaultsAssetsDelta!, wad)

    // the real harvest reports a slightly different delta
    mockHarvest()
    harvestSubVaults(META_VAULT, wad.plus(BigInt.fromI32(7)), TIMESTAMP)

    vault = Vault.load(META_VAULT.toHex())!
    assert.bigIntEquals(vault._periodEarnedAssets, wad.plus(BigInt.fromI32(7)))
    assert.bigIntEquals(vault._simulatedSubVaultsAssetsDelta!, BigInt.zero())
  })

  test('counts the latest simulation only before the harvest', () => {
    const simulatedCalls = setupSimulation()
    mockSimulation(simulatedCalls, true, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER)
    assert.assertTrue(simulate())

    // the harvest was missed, the next simulation is measured against the same stored total assets
    const twoWad = wad.times(BigInt.fromI32(2))
    mockSimulation(simulatedCalls, true, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER.plus(wad))
    assert.assertTrue(simulate())

    let vault = Vault.load(META_VAULT.toHex())!
    assert.bigIntEquals(vault._periodEarnedAssets, twoWad)
    assert.bigIntEquals(vault._simulatedSubVaultsAssetsDelta!, twoWad)

    mockHarvest()
    harvestSubVaults(META_VAULT, twoWad, TIMESTAMP)

    vault = Vault.load(META_VAULT.toHex())!
    assert.bigIntEquals(vault._periodEarnedAssets, twoWad)
  })

  test('keeps the state when the simulated calls revert', () => {
    mockSimulation(setupSimulation(), false, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER)

    assert.assertTrue(!simulate())

    const vault = Vault.load(META_VAULT.toHex())!
    assert.bigIntEquals(vault.rate, wad)
    assert.bigIntEquals(vault._periodEarnedAssets, BigInt.zero())
    assert.assertTrue(vault._simulatedSubVaultsAssetsDelta === null)
  })

  test('skips the simulation when the processed exit request is not claimable', () => {
    setupSimulation()
    const exitRequest = ExitRequest.load(`${SUB_VAULT1.toHex()}-10`)!
    exitRequest.isClaimable = false
    exitRequest.save()

    assert.assertTrue(!simulate())
  })

  test('skips the meta vault with the meta sub vault', () => {
    setupSimulation()
    const subVault = Vault.load(SUB_VAULT2.toHex())!
    subVault.isMetaVault = true
    subVault.save()

    assert.assertNull(loadSimulatedSubVaults(Vault.load(META_VAULT.toHex())!))
  })

  test('skips the meta vault when the sub vaults rewards roots differ', () => {
    setupSimulation()
    const subVault = Vault.load(SUB_VAULT2.toHex())!
    subVault.rewardsRoot = Bytes.fromHexString('0x' + '33'.repeat(32))
    subVault.save()

    assert.assertNull(loadSimulatedSubVaults(Vault.load(META_VAULT.toHex())!))
  })
  test('encodes the multicall aggregate call', () => {
    const target = Address.fromString('0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd')
    const call = encodeAggregateCall([encodeContractCall(target, Bytes.fromHexString('0x12345678'))]).toTuple()

    assert.addressEquals(call[0].toAddress(), Address.fromString(MULTICALL))
    assert.bytesEquals(
      call[1].toBytes(),
      Bytes.fromHexString(
        // selector, offset, length, call offset, target, data offset, data length, data
        '0x252dba42000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000041234567800000000000000000000000000000000000000000000000000000000',
      ),
    )
  })

  test('syncs the meta vault exit requests with the current chain state', () => {
    mockSimulation(setupSimulation(), true, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER)
    createUserExitRequest(META_VAULT, USER, 5, -1, false)

    // the exit request is not processed until the meta vault is harvested
    mockExitRequestUpdate(null, META_VAULT, USER, BigInt.fromI32(5), BigInt.fromI32(-1), wad, BigInt.zero())

    assert.assertTrue(simulate())

    const exitRequest = ExitRequest.load(`${META_VAULT.toHex()}-5`)!
    assert.assertTrue(exitRequest.exitQueueIndex === null)
    assert.bigIntEquals(exitRequest.exitedAssets, BigInt.zero())
    assert.assertTrue(!exitRequest.isClaimable)
  })

  test('claims the exit requests of all the sub vaults in the exit queue order', () => {
    createNetwork()
    createOsToken()
    createMetaVault()
    const subVault1 = createSubVault(SUB_VAULT1, true)
    createSubVault(SUB_VAULT2, false)
    // the exit requests are stored not in the position tickets order
    createExitRequest(SUB_VAULT1, 10, 4, true)
    createExitRequest(SUB_VAULT1, 9, 3, true)
    createExitRequest(SUB_VAULT2, 7, 1, true)
    createExitRequest(SUB_VAULT2, 8, -1, false)

    const subVault1Requests: Array<ExitRequest> = [
      ExitRequest.load(`${SUB_VAULT1.toHex()}-9`)!,
      ExitRequest.load(`${SUB_VAULT1.toHex()}-10`)!,
    ]
    const subVault2Requests: Array<ExitRequest> = [ExitRequest.load(`${SUB_VAULT2.toHex()}-7`)!]
    const claimedAssets = CLAIMED_ASSETS.times(BigInt.fromI32(3))
    // the sub vaults order is not guaranteed, the exit requests of each sub vault are claimed in the queue order
    const orders: Array<Array<ExitRequest>> = [
      subVault1Requests.concat(subVault2Requests),
      subVault2Requests.concat(subVault1Requests),
    ]
    for (let i = 0; i < orders.length; i++) {
      const simulatedCalls: Array<ethereum.Value> = [
        getUpdateStateCall(subVault1)!,
        encodeClaimSubVaultsExitedAssetsCall(REGISTRY, orders[i]),
        encodeMetaVaultUpdateStateCall(),
      ]
      mockSimulation(
        simulatedCalls,
        true,
        SUB_VAULTS_ASSETS_BEFORE,
        SUB_VAULTS_ASSETS_BEFORE.minus(claimedAssets).plus(wad),
      )
    }

    assert.assertTrue(simulate())
    assert.bigIntEquals(Vault.load(META_VAULT.toHex())!._periodEarnedAssets, wad)
  })

  test('applies the negative sub vaults assets delta', () => {
    mockSimulation(
      setupSimulation(),
      true,
      SUB_VAULTS_ASSETS_BEFORE,
      SUB_VAULTS_ASSETS_BEFORE.minus(CLAIMED_ASSETS).minus(wad),
    )

    assert.assertTrue(simulate())
    assert.bigIntEquals(Vault.load(META_VAULT.toHex())!._periodEarnedAssets, wad.neg())
  })

  test('skips the simulation when the harvestable sub vault has no proof', () => {
    setupSimulation()
    const subVault = Vault.load(SUB_VAULT1.toHex())!
    subVault.proof = null
    subVault.save()

    assert.assertTrue(!simulate())
  })

  test('skips the meta vault without the sub vaults registry or rewards', () => {
    setupSimulation()
    const vault = Vault.load(META_VAULT.toHex())!
    vault.subVaultsRegistry = null
    assert.assertNull(loadSimulatedSubVaults(vault))

    vault.subVaultsRegistry = REGISTRY
    vault.isCollateralized = false
    assert.assertNull(loadSimulatedSubVaults(vault))

    vault.isCollateralized = true
    const subVault = Vault.load(SUB_VAULT2.toHex())!
    subVault.rewardsRoot = null
    subVault.save()
    assert.assertNull(loadSimulatedSubVaults(vault))
  })

  test('syncs the meta vault with the simulated state after the keeper update', () => {
    mockSimulation(setupSimulation(), true, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER)
    const block = setKeeperUpdated(true)

    syncVaults(block)

    assert.bigIntEquals(Vault.load(META_VAULT.toHex())!.rate, NEW_RATE)
    assert.bigIntEquals(createOrLoadCheckpoint(CheckpointType.VAULTS).timestamp, block.timestamp)
  })

  test('keeps the meta vault state when the simulation reverts in the keeper update pass', () => {
    mockSimulation(setupSimulation(), false, SUB_VAULTS_ASSETS_BEFORE, SUB_VAULTS_ASSETS_AFTER)
    const block = setKeeperUpdated(true)

    syncVaults(block)

    assert.bigIntEquals(Vault.load(META_VAULT.toHex())!.rate, wad)
    assert.bigIntEquals(createOrLoadCheckpoint(CheckpointType.VAULTS).timestamp, block.timestamp)
  })

  test('does not simulate the meta vault state update without the keeper update', () => {
    // the multicall is not mocked, the simulation would fail the test
    setupSimulation()
    const block = setKeeperUpdated(false)

    syncVaults(block)

    assert.bigIntEquals(Vault.load(META_VAULT.toHex())!.rate, wad)
  })

  test('syncs the sub vaults exit requests before simulating the meta vault state update', () => {
    createNetwork()
    createOsToken()
    createMetaVault()
    const subVault1 = createSubVault(SUB_VAULT1, true)
    createSubVault(SUB_VAULT2, false)
    // the meta vault exit request is processed by the sub vault 1 harvest in the keeper update block
    createExitRequest(SUB_VAULT1, 10, -1, false)
    const block = setKeeperUpdated(true)
    // the meta vault goes before its sub vaults
    const network = Network.load('0')!
    network.vaultIds = [META_VAULT.toHex(), SUB_VAULT1.toHex(), SUB_VAULT2.toHex()]
    network.save()

    const subVault1UpdateStateCall = getUpdateStateCall(subVault1)!
    mockExitRequestUpdate(
      subVault1UpdateStateCall,
      SUB_VAULT1,
      META_VAULT,
      BigInt.fromI32(10),
      BigInt.fromI32(3),
      wad.div(BigInt.fromI32(2)),
      CLAIMED_ASSETS,
    )
    // the simulation claims the exit request refreshed by the sub vault sync
    const exitRequest = ExitRequest.load(`${SUB_VAULT1.toHex()}-10`)!
    exitRequest.exitQueueIndex = BigInt.fromI32(3)
    mockSimulation(
      [
        subVault1UpdateStateCall,
        encodeClaimSubVaultsExitedAssetsCall(REGISTRY, [exitRequest]),
        encodeMetaVaultUpdateStateCall(),
      ],
      true,
      SUB_VAULTS_ASSETS_BEFORE,
      SUB_VAULTS_ASSETS_AFTER,
    )

    syncVaults(block)

    const vault = Vault.load(META_VAULT.toHex())!
    assert.bigIntEquals(vault.rate, NEW_RATE)
    // the claimed exited assets are included in the sub vaults assets delta
    assert.bigIntEquals(vault._simulatedSubVaultsAssetsDelta!, wad)
  })
})
