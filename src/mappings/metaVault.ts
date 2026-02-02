import { Address, BigInt, log, store } from '@graphprotocol/graph-ts'
import { SubVault } from '../../generated/schema'
import { SubVaultAdded, SubVaultEjected, SubVaultsHarvested } from '../../generated/templates/MetaVault/MetaVault'
import { loadVault, syncVault } from '../entities/vault'
import { loadOsToken } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import { getMetaVaultState } from '../entities/metaVault'
import { createTransaction } from '../entities/transaction'

export function addSubVault(metaVaultAddress: Address, subVaultAddress: Address): void {
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = new SubVault(subVaultId)
  subVault.metaVault = metaVaultAddress.toHex()
  subVault.subVault = subVaultAddress
  subVault.save()

  const metaVault = loadVault(metaVaultAddress)!
  metaVault.isCollateralized = true
  if (metaVault.pendingMetaSubVault !== null && metaVault.pendingMetaSubVault!.equals(subVaultAddress)) {
    metaVault.pendingMetaSubVault = null
  }
  metaVault.save()
}

export function ejectSubVault(metaVaultAddress: Address, subVaultAddress: Address): void {
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = SubVault.load(subVaultId)
  if (subVault) {
    store.remove('SubVault', subVaultId)
  }

  // Clear ejectingSubVault on meta vault
  const metaVault = loadVault(metaVaultAddress)!
  metaVault.ejectingSubVault = null
  metaVault.save()
}

export function harvestSubVaults(metaVaultAddress: Address, totalAssetsDelta: BigInt, timestamp: BigInt): void {
  const vault = loadVault(metaVaultAddress)!
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
    log.error('[MetaVault] No sub vaults found for vault {}', [metaVaultAddress.toHex()])
    return
  }
  const subVault = loadVault(Address.fromBytes(subVaults[0].subVault))!

  // update vault
  vault.totalAssets = newTotalAssets
  vault.totalShares = newTotalShares
  vault.queuedShares = newQueuedShares
  vault.exitingAssets = newExitingAssets
  vault.rate = newRate
  vault.rewardsRoot = subVault.rewardsRoot
  vault.canHarvest = subVault.canHarvest
  vault.rewardsIpfsHash = subVault.rewardsIpfsHash
  vault.rewardsTimestamp = subVault.rewardsTimestamp
  vault._periodEarnedAssets = vault._periodEarnedAssets.plus(totalAssetsDelta)
  vault.save()

  // TODO: fix fee recipient shares minted

  // update vault allocators, exit requests, reward splitters
  syncVault(loadNetwork()!, osToken, vault, timestamp)
}

export function handleSubVaultAdded(event: SubVaultAdded): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault

  addSubVault(metaVaultAddress, subVaultAddress)

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVault] SubVaultAdded metaVault={} subVault={}', [metaVaultAddress.toHex(), subVaultAddress.toHex()])
}

export function handleSubVaultEjected(event: SubVaultEjected): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault

  ejectSubVault(metaVaultAddress, subVaultAddress)

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVault] SubVaultEjected metaVault={} subVault={}', [metaVaultAddress.toHex(), subVaultAddress.toHex()])
}

export function handleSubVaultsHarvested(event: SubVaultsHarvested): void {
  const metaVaultAddress = event.address
  const totalAssetsDelta = event.params.totalAssetsDelta
  const timestamp = event.block.timestamp

  harvestSubVaults(metaVaultAddress, totalAssetsDelta, timestamp)

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVault] SubVaultsHarvested metaVault={} delta={}', [
    metaVaultAddress.toHex(),
    totalAssetsDelta.toString(),
  ])
}
