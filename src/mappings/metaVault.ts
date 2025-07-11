import { Address, log, store } from '@graphprotocol/graph-ts'
import { SubVault } from '../../generated/schema'
import { SubVaultAdded, SubVaultEjected, SubVaultsHarvested } from '../../generated/templates/MetaVault/MetaVault'
import { loadVault, syncVault, updateVaultApy } from '../entities/vault'
import { loadOsToken } from '../entities/osToken'
import { loadDistributor } from '../entities/merkleDistributor'
import { loadNetwork } from '../entities/network'
import { getMetaVaultState } from '../entities/metaVault'

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

  // load used objects
  const vaultAddress = event.address
  const vault = loadVault(vaultAddress)!
  const distributor = loadDistributor()!
  const osToken = loadOsToken()!

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
  vault._periodEarnedAssets = vault._periodEarnedAssets.plus(vaultPeriodAssets)
  vault.save()

  // update vault allocators, exit requests, reward splitters
  syncVault(loadNetwork()!, osToken, vault, timestamp)

  log.info('[MetaVault] SubVaultsHarvested delta={}', [vaultPeriodAssets.toString()])
}
