import { Address, BigDecimal, BigInt, Bytes, ethereum, log, store } from '@graphprotocol/graph-ts'
import { Allocator, ExitRequest, Network, OsToken, SubVault, SubVaultsRegistryMap, Vault } from '../../generated/schema'
import { SubVaultsRegistry as SubVaultsRegistryContract } from '../../generated/templates/SubVaultsRegistry/SubVaultsRegistry'
import { MetaVaultCreated } from '../../generated/templates/MetaVaultFactory/MetaVaultFactory'
import {
  Erc20Vault as Erc20VaultTemplate,
  MetaVault as MetaVaultTemplate,
  PrivateVault as PrivateVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { MULTICALL, WAD } from '../helpers/constants'
import { chunkedMulticall, encodeContractCall } from '../helpers/utils'
import { loadNetwork } from './network'
import { loadOsToken } from './osToken'
import { MAIN_META_VAULT_ADDRESS, syncStaker } from './staker'
import { createTransaction } from './transaction'
import { loadAllocator } from './allocator'
import {
  encodeUpdateStateCall,
  exitQueueDataSelector,
  getConvertToAssetsCall,
  getSharesCall,
  getUpdateStateCall,
  loadVault,
  syncFeeRecipientShares,
  syncVault,
  totalAssetsSelector,
  totalSharesSelector,
} from './vault'

const subVaultsTotalAssetsSelector = '0x829e6cab'
const claimSubVaultsExitedAssetsSelector = '0xe620196c'
const aggregateSelector = '0x252dba42'

export function createMetaVault(event: MetaVaultCreated, version: BigInt, isPrivate: boolean, isErc20: boolean): void {
  const block = event.block
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const vault = new Vault(vaultAddressHex)
  let decodedParams: ethereum.Tuple
  let curator: Address
  let capacity: BigInt
  let feePercent: i32
  let metadataIpfsHash: string

  if (isErc20) {
    decodedParams = (
      ethereum.decode('(address,uint256,uint16,string,string,string)', event.params.params) as ethereum.Value
    ).toTuple()
    curator = decodedParams[0].toAddress()
    capacity = decodedParams[1].toBigInt()
    feePercent = decodedParams[2].toI32()
    vault.tokenName = decodedParams[3].toString()
    vault.tokenSymbol = decodedParams[4].toString()
    metadataIpfsHash = decodedParams[5].toString()
    Erc20VaultTemplate.create(vaultAddress)
  } else {
    decodedParams = (
      ethereum.decode('(address,uint256,uint16,string)', event.params.params) as ethereum.Value
    ).toTuple()
    curator = decodedParams[0].toAddress()
    capacity = decodedParams[1].toBigInt()
    feePercent = decodedParams[2].toI32()
    metadataIpfsHash = decodedParams[3].toString()
  }
  const admin = event.params.admin

  vault.factory = event.address
  vault.admin = admin
  vault.capacity = capacity
  vault.feePercent = feePercent
  vault.feeRecipient = admin
  vault.depositDataManager = Address.zero()
  vault.canHarvest = false
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.isPrivate = isPrivate
  vault.isBlocklist = false
  vault.isErc20 = isErc20
  vault.isMetaVault = true
  vault.isOsTokenEnabled = true
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.baseApy = BigDecimal.zero()
  vault.extraApy = BigDecimal.zero()
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = version
  vault.validatorsManager = Address.zero()
  vault.osTokenConfig = '2'
  vault.metadataIpfsHash = metadataIpfsHash
  vault.subVaultsCount = 0
  vault.parentMetaVaults = []
  vault.subVaultsCurator = curator
  vault.isStateUpdateRequired = false
  vault._periodEarnedAssets = BigInt.zero()
  vault._prevAllocatorAssets = BigInt.fromString(WAD)

  if (isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = admin
  }

  vault.save()

  VaultTemplate.create(vaultAddress)
  MetaVaultTemplate.create(vaultAddress)

  const network = loadNetwork()!
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.vaultsCount = network.vaultsCount + 1
  network.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVaultFactory] MetaVaultCreated address={} admin={} feePercent={} capacity={} curator={}', [
    vaultAddressHex,
    admin.toHex(),
    feePercent.toString(),
    capacity.toString(),
    curator.toHexString(),
  ])
}

export class MetaVaultState {
  rate: BigInt = BigInt.zero()
  totalAssets: BigInt = BigInt.zero()
  totalShares: BigInt = BigInt.zero()
  queuedShares: BigInt = BigInt.zero()
  exitingAssets: BigInt = BigInt.zero()
  // the fee recipient shares are read after the harvest, so they already include the minted fee shares
  feeRecipientShares: BigInt = BigInt.zero()
  // the registry sub vaults total assets before and after the simulated state update
  subVaultsAssetsBeforeSimulation: BigInt = BigInt.zero()
  subVaultsAssetsAfterSimulation: BigInt = BigInt.zero()
}

// Fetches the actual meta vault state after the real harvest (SubVaultsHarvested), without simulation.
// The sub vaults total assets fields are not set.
export function getMetaVaultState(vault: Vault): MetaVaultState {
  const results = chunkedMulticall(null, _getMetaVaultStateCalls(vault))
  return _decodeMetaVaultState(results)
}

// Fetches the meta vault state and the registry sub vaults total assets before and after the simulated state update.
// Returns null if the simulated state update reverts.
export function getSimulatedMetaVaultState(vault: Vault, simulatedCall: ethereum.Value): MetaVaultState | null {
  const subVaultsTotalAssetsCall = encodeContractCall(
    Address.fromBytes(vault.subVaultsRegistry!),
    Bytes.fromHexString(subVaultsTotalAssetsSelector),
  )
  // [sub vaults total assets, simulated call, state calls, sub vaults total assets]
  const calls: Array<ethereum.Value> = [subVaultsTotalAssetsCall, simulatedCall]
  const allCalls = calls.concat(_getMetaVaultStateCalls(vault)).concat([subVaultsTotalAssetsCall])

  // the state calls must be executed in a single multicall on top of the simulated state update
  const results = chunkedMulticall(null, allCalls, false, allCalls.length)
  for (let i = 0; i < results.length; i++) {
    if (results[i] === null) {
      return null
    }
  }

  const lastIndex = results.length - 1
  const state = _decodeMetaVaultState(results.slice(2, lastIndex))
  state.subVaultsAssetsBeforeSimulation = ethereum.decode('uint256', results[0]!)!.toBigInt()
  state.subVaultsAssetsAfterSimulation = ethereum.decode('uint256', results[lastIndex]!)!.toBigInt()
  return state
}

function _getMetaVaultStateCalls(vault: Vault): Array<ethereum.Value> {
  const vaultAddr = Address.fromString(vault.id)
  return [
    encodeContractCall(vaultAddr, getConvertToAssetsCall(BigInt.fromString(WAD))),
    encodeContractCall(vaultAddr, Bytes.fromHexString(totalAssetsSelector)),
    encodeContractCall(vaultAddr, Bytes.fromHexString(totalSharesSelector)),
    encodeContractCall(vaultAddr, Bytes.fromHexString(exitQueueDataSelector)),
    encodeContractCall(vaultAddr, getSharesCall(Address.fromBytes(vault.feeRecipient))),
  ]
}

function _decodeMetaVaultState(results: Array<Bytes | null>): MetaVaultState {
  const state = new MetaVaultState()
  state.rate = ethereum.decode('uint256', results[0]!)!.toBigInt()
  state.totalAssets = ethereum.decode('uint256', results[1]!)!.toBigInt()
  state.totalShares = ethereum.decode('uint256', results[2]!)!.toBigInt()
  const exitQueueData = ethereum.decode('(uint128,uint128,uint128,uint128,uint256)', results[3]!)!.toTuple()
  state.queuedShares = exitQueueData[0].toBigInt()
  state.exitingAssets = exitQueueData[3].toBigInt()
  state.feeRecipientShares = ethereum.decode('uint256', results[4]!)!.toBigInt()
  return state
}

export function encodeClaimSubVaultsExitedAssetsCall(
  registry: Address,
  exitRequests: Array<ExitRequest>,
): ethereum.Value {
  const tuples: Array<ethereum.Tuple> = []
  for (let i = 0; i < exitRequests.length; i++) {
    const exitRequest = exitRequests[i]
    const values: Array<ethereum.Value> = [
      ethereum.Value.fromUnsignedBigInt(exitRequest.exitQueueIndex!),
      ethereum.Value.fromAddress(Address.fromString(exitRequest.vault)),
      ethereum.Value.fromUnsignedBigInt(exitRequest.timestamp),
    ]
    tuples.push(changetype<ethereum.Tuple>(values))
  }
  const encodedArgs = ethereum.encode(ethereum.Value.fromTupleArray(tuples))!
  return encodeContractCall(registry, Bytes.fromHexString(claimSubVaultsExitedAssetsSelector).concat(encodedArgs))
}

// Wraps the calls into the multicall aggregate call that reverts if any of the calls fails
export function encodeAggregateCall(calls: Array<ethereum.Value>): ethereum.Value {
  const encodedArgs = ethereum.encode(ethereum.Value.fromArray(calls))!
  return encodeContractCall(Address.fromString(MULTICALL), Bytes.fromHexString(aggregateSelector).concat(encodedArgs))
}

export function getMetaVaultAddress(registryAddress: Address): Address {
  const registryMap = SubVaultsRegistryMap.load(registryAddress.toHex())!
  return Address.fromBytes(registryMap.metaVault)
}

export function addSubVault(metaVaultAddress: Address, subVaultAddress: Address): void {
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = new SubVault(subVaultId)
  subVault.metaVault = metaVaultAddress.toHex()
  subVault.subVault = subVaultAddress.toHex()
  subVault.save()

  const metaVault = loadVault(metaVaultAddress)!
  const wasCollateralized = metaVault.isCollateralized
  metaVault.isCollateralized = true
  metaVault.subVaultsCount = metaVault.subVaultsCount + 1
  if (metaVault.pendingMetaSubVault !== null && metaVault.pendingMetaSubVault!.equals(subVaultAddress)) {
    metaVault.pendingMetaSubVault = null
  }
  metaVault.save()

  if (!wasCollateralized) {
    const network = loadNetwork()!
    network.collateralizedVaultsCount = network.collateralizedVaultsCount + 1
    network.save()
  }

  const subVaultEntity = loadVault(subVaultAddress)
  if (subVaultEntity) {
    const parentMetaVaults = subVaultEntity.parentMetaVaults
    parentMetaVaults.push(metaVaultAddress)
    subVaultEntity.parentMetaVaults = parentMetaVaults
    subVaultEntity.save()
  } else {
    log.warning(
      '[MetaVault] addSubVault subVault entity not found, parentMetaVaults not updated metaVault={} subVault={}',
      [metaVaultAddress.toHex(), subVaultAddress.toHex()],
    )
  }
}

export function ejectSubVault(metaVaultAddress: Address, subVaultAddress: Address): void {
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = SubVault.load(subVaultId)
  const metaVault = loadVault(metaVaultAddress)!

  if (subVault) {
    store.remove('SubVault', subVaultId)
    if (metaVault.subVaultsCount > 0) {
      metaVault.subVaultsCount = metaVault.subVaultsCount - 1
    }

    const subVaultEntity = loadVault(subVaultAddress)
    if (subVaultEntity) {
      const parentMetaVaults = subVaultEntity.parentMetaVaults
      const index = parentMetaVaults.indexOf(metaVaultAddress)
      if (index >= 0) {
        parentMetaVaults.splice(index, 1)
        subVaultEntity.parentMetaVaults = parentMetaVaults
        subVaultEntity.save()
      } else {
        log.warning('[MetaVault] ejectSubVault missing parentMetaVault reference metaVault={} subVault={}', [
          metaVaultAddress.toHex(),
          subVaultAddress.toHex(),
        ])
      }
    }
  }

  // Clear ejectingSubVault on meta vault
  metaVault.ejectingSubVault = null
  metaVault.save()
}

export function harvestSubVaults(metaVaultAddress: Address, totalAssetsDelta: BigInt, timestamp: BigInt): void {
  const vault = loadVault(metaVaultAddress)!

  const subVaults: Array<SubVault> = vault.subVaults.load()
  if (subVaults.length == 0) {
    log.error('[MetaVault] No sub vaults found for vault {}', [metaVaultAddress.toHex()])
    return
  }
  const subVault = loadVault(Address.fromString(subVaults[0].subVault))!

  // fetch vault state
  const newState = getMetaVaultState(vault)

  if (vault.subVaultsRegistry) {
    const registry = SubVaultsRegistryContract.bind(Address.fromBytes(vault.subVaultsRegistry!))
    vault.canHarvest = registry.canUpdateState()
  } else {
    vault.canHarvest = subVault.canHarvest
  }
  _addSubVaultsAssetsDelta(vault, totalAssetsDelta, BigInt.zero())
  vault.lastUpdateStateTimestamp = timestamp

  _applyMetaVaultState(loadNetwork()!, loadOsToken()!, vault, newState, subVault, timestamp)
}

// Returns the sub vaults of the meta vault if its state update can be simulated, otherwise null
export function loadSimulatedSubVaults(vault: Vault): Array<Vault> | null {
  if (vault.subVaultsRegistry === null || !vault.isCollateralized) {
    return null
  }
  const subVaults: Array<SubVault> = vault.subVaults.load()
  if (subVaults.length == 0) {
    return null
  }

  const subVaultEntities: Array<Vault> = []
  let rewardsRoot: Bytes | null = null
  for (let i = 0; i < subVaults.length; i++) {
    const subVault = loadVault(Address.fromString(subVaults[i].subVault))
    if (subVault === null || subVault.isMetaVault || subVault.rewardsRoot === null) {
      return null
    }
    // the sub vault missing from the latest rewards update keeps the old rewards root,
    // the meta vault state update reverts until all the sub vaults are harvested with the same nonce
    if (rewardsRoot === null) {
      rewardsRoot = subVault.rewardsRoot
    } else if (!rewardsRoot.equals(subVault.rewardsRoot!)) {
      return null
    }
    subVaultEntities.push(subVault)
  }
  return subVaultEntities
}

// Simulates the meta vault state update sent by the operator: harvests the sub vaults, claims the exited assets
// of the sub vaults and updates the meta vault state. Returns false if the state update cannot be simulated.
export function simulateMetaVaultUpdateState(
  network: Network,
  osToken: OsToken,
  vault: Vault,
  subVaults: Array<Vault>,
  timestamp: BigInt,
): boolean {
  const vaultAddress = Address.fromString(vault.id)
  const calls: Array<ethereum.Value> = []
  const claimExitRequests: Array<ExitRequest> = []
  let claimedAssets = BigInt.zero()
  for (let i = 0; i < subVaults.length; i++) {
    const subVault = subVaults[i]
    const subVaultAddress = Address.fromString(subVault.id)
    if (subVault.canHarvest) {
      const updateStateCall = getUpdateStateCall(subVault)
      if (updateStateCall === null) {
        log.warning('[MetaVault] simulation skipped, missing sub vault proof metaVault={} subVault={}', [
          vault.id,
          subVault.id,
        ])
        return false
      }
      calls.push(updateStateCall)
    }

    // the meta vault state update reverts if there are unclaimed exited assets in the sub vaults
    const allocator = loadAllocator(vaultAddress, subVaultAddress)
    if (allocator === null) {
      continue
    }
    const exitRequests: Array<ExitRequest> = allocator.exitRequests.load().filter((e: ExitRequest) => !e.isClaimed)
    // the registry claims the exit positions in the order they were created
    exitRequests.sort((a: ExitRequest, b: ExitRequest): i32 => (a.positionTicket.lt(b.positionTicket) ? -1 : 1))
    for (let j = 0; j < exitRequests.length; j++) {
      const exitRequest = exitRequests[j]
      if (exitRequest.exitQueueIndex === null) {
        break
      }
      if (!exitRequest.isClaimable) {
        log.info('[MetaVault] simulation skipped, sub vault exit request is not claimable metaVault={} id={}', [
          vault.id,
          exitRequest.id,
        ])
        return false
      }
      claimExitRequests.push(exitRequest)
      claimedAssets = claimedAssets.plus(exitRequest.exitedAssets)
    }
  }

  const registryAddress = Address.fromBytes(vault.subVaultsRegistry!)
  if (claimExitRequests.length > 0) {
    calls.push(encodeClaimSubVaultsExitedAssetsCall(registryAddress, claimExitRequests))
  }
  // the meta vault ignores the harvest params
  calls.push(
    encodeUpdateStateCall(
      vaultAddress,
      Bytes.fromUint8Array(new Uint8Array(32)),
      BigInt.zero(),
      BigInt.zero(),
      new Array<Bytes>(),
    ),
  )

  const simulatedCall = encodeAggregateCall(calls)
  const newState = getSimulatedMetaVaultState(vault, simulatedCall)
  if (newState === null) {
    log.error('[MetaVault] simulated state update reverted metaVault={}', [vault.id])
    return false
  }

  // the claimed exited assets are deducted from the sub vaults total assets before the harvest
  const subVaultsAssetsDelta = newState.subVaultsAssetsAfterSimulation
    .minus(newState.subVaultsAssetsBeforeSimulation)
    .plus(claimedAssets)
  _addSubVaultsAssetsDelta(vault, subVaultsAssetsDelta, subVaultsAssetsDelta)

  _applyMetaVaultState(network, osToken, vault, newState, subVaults[0], timestamp)
  return true
}

// Adds the sub vaults assets delta to the period earned assets excluding the delta
// already added by the previous simulated state update
function _addSubVaultsAssetsDelta(vault: Vault, subVaultsAssetsDelta: BigInt, simulatedAssetsDelta: BigInt): void {
  const prevSimulatedAssetsDelta =
    vault._simulatedSubVaultsAssetsDelta !== null ? vault._simulatedSubVaultsAssetsDelta! : BigInt.zero()
  vault._periodEarnedAssets = vault._periodEarnedAssets.plus(subVaultsAssetsDelta).minus(prevSimulatedAssetsDelta)
  vault._simulatedSubVaultsAssetsDelta = simulatedAssetsDelta
}

function _applyMetaVaultState(
  network: Network,
  osToken: OsToken,
  vault: Vault,
  newState: MetaVaultState,
  subVault: Vault,
  timestamp: BigInt,
): void {
  // update vault. Network total assets are not updated here, because meta vault assets are
  // delegated to the sub vaults and are already counted there (see updateNetworkTotalAssets).
  vault.rate = newState.rate
  vault.totalAssets = newState.totalAssets
  vault.totalShares = newState.totalShares
  vault.queuedShares = newState.queuedShares
  vault.exitingAssets = newState.exitingAssets
  vault.rewardsRoot = subVault.rewardsRoot
  vault.rewardsIpfsHash = subVault.rewardsIpfsHash
  vault.rewardsTimestamp = subVault.rewardsTimestamp
  vault.save()

  // sync fee recipient shares with the state fetched from the chain (fee shares are minted on harvest)
  syncFeeRecipientShares(osToken, vault, newState.feeRecipientShares)

  // update vault allocators, exit requests, reward splitters. The exit requests and reward splitters are read
  // from the current chain state: the operator may not harvest the meta vault for a long time, and the exit
  // requests processed by the simulated state update cannot be claimed until then
  syncVault(network, osToken, vault, timestamp)

  // refresh the stakers with the new state
  if (Address.fromString(vault.id).equals(MAIN_META_VAULT_ADDRESS)) {
    const allocators: Array<Allocator> = vault.allocators.load()
    for (let i = 0; i < allocators.length; i++) {
      syncStaker(Address.fromBytes(allocators[i].address))
    }
  }
}
