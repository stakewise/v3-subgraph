import { Address, BigDecimal, BigInt, log, store } from '@graphprotocol/graph-ts'
import { Allocator, SubVault } from '../../generated/schema'
import { SubVaultsHarvested, SubVaultAdded, SubVaultEjected } from '../../generated/templates/MetaVault/MetaVault'
import { loadVault, snapshotVault, updateVaultApy, updateVaultMaxBoostApy } from '../entities/vault'
import { loadOsToken } from '../entities/osToken'
import { loadDistributor } from '../entities/merkleDistributor'
import { loadAave } from '../entities/aave'
import { loadNetwork } from '../entities/network'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { getMetaVaultState } from '../entities/metaVault'
import { getAllocatorApy, updateAllocatorAssets } from '../entities/allocator'
import { updateExitRequests } from '../entities/exitRequest'
import { updateRewardSplitters } from '../entities/rewardSplitter'
import { updateOsTokenExitRequests } from '../entities/osTokenVaultEscrow'
import { updateLeverageStrategyPositions } from '../entities/leverageStrategy'

export function handleSubVaultAdded(event: SubVaultAdded): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = new SubVault(subVaultId)
  subVault.metaVault = metaVaultAddress.toHex()
  subVault.subVault = subVaultAddress
  subVault.save()

  const metaVault = loadVault(metaVaultAddress)!
  metaVault.isCollateralized = true
  metaVault.save()

  log.info('[MetaVault] SubVaultAdded metaVault={} subVault={}', [metaVaultAddress.toHex(), subVaultAddress.toHex()])
}

export function handleSubVaultEjected(event: SubVaultEjected): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  // Check if the SubVault entity exists before removing it
  const subVault = SubVault.load(subVaultId)
  if (subVault) {
    store.remove('SubVault', subVaultId)

    log.info('[MetaVault] SubVaultEjected metaVault={} subVault={}', [
      metaVaultAddress.toHex(),
      subVaultAddress.toHex(),
    ])
  } else {
    log.warning('[MetaVault] SubVaultEjected for non-existent subVault metaVault={} subVault={}', [
      metaVaultAddress.toHex(),
      subVaultAddress.toHex(),
    ])
  }
}

export function handleSubVaultsHarvested(event: SubVaultsHarvested): void {
  const vaultPeriodAssets = event.params.totalAssetsDelta
  const timestamp = event.block.timestamp
  const blockNumber = event.block.number

  // load used objects
  const vaultAddress = event.address
  const vault = loadVault(vaultAddress)!
  const distributor = loadDistributor()!
  const osToken = loadOsToken()!
  const aave = loadAave()!

  // fetch vault state
  const newState = getMetaVaultState(vault)
  const newRate = newState[0]
  const newTotalAssets = newState[1]
  const newTotalShares = newState[2]
  const newQueuedShares = newState[3]
  const newExitingAssets = newState[4]

  const subVaults: Array<SubVault> = vault.subVaults.load()
  if (subVaults.length == 0) {
    log.error('[MetaVault] No sub vaults found for vault {}', [vaultAddress.toHex()])
    return
  }
  const subVault = loadVault(Address.fromBytes(subVaults[0].subVault))!

  // update vault
  updateVaultApy(
    vault,
    distributor,
    osToken,
    vault.rewardsTimestamp,
    subVault.rewardsTimestamp!,
    newRate.minus(vault.rate),
    false,
  )
  vault.totalAssets = newTotalAssets
  vault.totalShares = newTotalShares
  vault.queuedShares = newQueuedShares
  vault.exitingAssets = newExitingAssets
  vault.rate = newRate
  vault.rewardsRoot = subVault.rewardsRoot
  vault.rewardsIpfsHash = subVault.rewardsIpfsHash
  vault.rewardsTimestamp = subVault.rewardsTimestamp
  vault.save()
  snapshotVault(vault, distributor, osToken, vaultPeriodAssets, vault.rewardsTimestamp!)

  const network = loadNetwork()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  // update allocators
  let earnedAssets: BigInt
  let allocator: Allocator
  let allocators: Array<Allocator> = vault.allocators.load()
  for (let j = 0; j < allocators.length; j++) {
    allocator = allocators[j]
    earnedAssets = updateAllocatorAssets(osToken, osTokenConfig, vault, allocator)
    allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(earnedAssets)
    allocator.save()
  }

  // update exit requests
  updateExitRequests(network, vault, timestamp)

  // update reward splitters
  updateRewardSplitters(vault)

  // update OsToken exit requests
  updateOsTokenExitRequests(osToken, vault)

  // update leverage strategy positions
  updateLeverageStrategyPositions(network, aave, osToken, vault)

  // update allocators apys
  let allocatorApy: BigDecimal

  // reload allocators in case they were updated
  allocators = vault.allocators.load()
  for (let j = 0; j < allocators.length; j++) {
    allocator = allocators[j]
    allocatorApy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator)
    if (allocatorApy.equals(allocator.apy)) {
      continue
    }
    allocator.apy = allocatorApy
    allocator.save()
  }

  // update vault max boost apys
  updateVaultMaxBoostApy(aave, osToken, vault, osTokenConfig, distributor, blockNumber)
  log.info('[MetaVault] SubVaultsHarvested delta={}', [vaultPeriodAssets.toString()])
}
