import { Address, log } from '@graphprotocol/graph-ts'
import { SubVaultsRegistryMap } from '../../generated/schema'
import {
  SubVaultAdded,
  SubVaultEjected,
  SubVaultEjecting,
  SubVaultsHarvested,
  MetaSubVaultProposed,
  MetaSubVaultRejected,
} from '../../generated/templates/SubVaultsRegistry/SubVaultsRegistry'
import { addSubVault, ejectSubVault, harvestSubVaults } from './metaVault'
import { loadVault } from '../entities/vault'
import { createTransaction } from '../entities/transaction'

function getMetaVaultAddress(registryAddress: Address): Address {
  const registryMap = SubVaultsRegistryMap.load(registryAddress.toHex())
  if (!registryMap) {
    log.error('[SubVaultsRegistry] No mapping found for registry {}', [registryAddress.toHex()])
    return Address.zero()
  }
  return Address.fromBytes(registryMap.metaVault)
}

export function handleSubVaultAdded(event: SubVaultAdded): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)
  if (metaVaultAddress.equals(Address.zero())) {
    return
  }

  const subVaultAddress = event.params.vault
  addSubVault(metaVaultAddress, subVaultAddress)

  createTransaction(event.transaction.hash.toHex())

  log.info('[SubVaultsRegistry] SubVaultAdded metaVault={} subVault={}', [
    metaVaultAddress.toHex(),
    subVaultAddress.toHex(),
  ])
}

export function handleSubVaultEjected(event: SubVaultEjected): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)
  if (metaVaultAddress.equals(Address.zero())) {
    return
  }

  const subVaultAddress = event.params.vault
  ejectSubVault(metaVaultAddress, subVaultAddress)

  createTransaction(event.transaction.hash.toHex())

  log.info('[SubVaultsRegistry] SubVaultEjected metaVault={} subVault={}', [
    metaVaultAddress.toHex(),
    subVaultAddress.toHex(),
  ])
}

export function handleSubVaultsHarvested(event: SubVaultsHarvested): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)
  if (metaVaultAddress.equals(Address.zero())) {
    return
  }

  const totalAssetsDelta = event.params.totalAssetsDelta
  harvestSubVaults(metaVaultAddress, totalAssetsDelta, event.block.timestamp)

  createTransaction(event.transaction.hash.toHex())

  log.info('[SubVaultsRegistry] SubVaultsHarvested metaVault={} delta={}', [
    metaVaultAddress.toHex(),
    totalAssetsDelta.toString(),
  ])
}

export function handleSubVaultEjecting(event: SubVaultEjecting): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)
  const subVaultAddress = event.params.vault

  // Set ejectingSubVault on meta vault
  const metaVault = loadVault(metaVaultAddress)!
  metaVault.ejectingSubVault = subVaultAddress
  metaVault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[SubVaultsRegistry] SubVaultEjecting metaVault={} subVault={}', [
    metaVaultAddress.toHex(),
    subVaultAddress.toHex(),
  ])
}

export function handleMetaSubVaultProposed(event: MetaSubVaultProposed): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)
  const subVaultAddress = event.params.vault

  // Set pendingMetaSubVault on meta vault
  const metaVault = loadVault(metaVaultAddress)!
  metaVault.pendingMetaSubVault = subVaultAddress
  metaVault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[SubVaultsRegistry] MetaSubVaultProposed metaVault={} subVault={}', [
    metaVaultAddress.toHex(),
    subVaultAddress.toHex(),
  ])
}

export function handleMetaSubVaultRejected(event: MetaSubVaultRejected): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)
  const subVaultAddress = event.params.vault

  // Clear pendingMetaSubVault on meta vault
  const metaVault = loadVault(metaVaultAddress)!
  metaVault.pendingMetaSubVault = null
  metaVault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[SubVaultsRegistry] MetaSubVaultRejected metaVault={} subVault={}', [
    metaVaultAddress.toHex(),
    subVaultAddress.toHex(),
  ])
}
