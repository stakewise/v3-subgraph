import { log } from '@graphprotocol/graph-ts'
import {
  SubVaultAdded as SubVaultAddedV1,
  SubVaultEjected as SubVaultEjectedV1,
  SubVaultEjecting as SubVaultEjectingV1,
  SubVaultsHarvested as SubVaultsHarvestedV1,
} from '../../generated/templates/MetaVault/MetaVault'
import {
  SubVaultAdded,
  SubVaultEjected,
  SubVaultEjecting,
  SubVaultsHarvested,
  MetaSubVaultProposed,
  MetaSubVaultRejected,
} from '../../generated/templates/SubVaultsRegistry/SubVaultsRegistry'
import { loadVault } from '../entities/vault'
import { addSubVault, ejectSubVault, getMetaVaultAddress, harvestSubVaults } from '../entities/metaVault'
import { createTransaction } from '../entities/transaction'

// V1 handlers (MetaVault template)
export function handleSubVaultAddedV1(event: SubVaultAddedV1): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault

  addSubVault(metaVaultAddress, subVaultAddress)

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVault] SubVaultAdded metaVault={} subVault={}', [metaVaultAddress.toHex(), subVaultAddress.toHex()])
}

export function handleSubVaultEjectedV1(event: SubVaultEjectedV1): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault

  ejectSubVault(metaVaultAddress, subVaultAddress)

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVault] SubVaultEjected metaVault={} subVault={}', [metaVaultAddress.toHex(), subVaultAddress.toHex()])
}

export function handleSubVaultsHarvestedV1(event: SubVaultsHarvestedV1): void {
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

export function handleSubVaultEjectingV1(event: SubVaultEjectingV1): void {
  const metaVaultAddress = event.address
  const subVaultAddress = event.params.vault

  // Set ejectingSubVault on meta vault
  const metaVault = loadVault(metaVaultAddress)!
  metaVault.ejectingSubVault = subVaultAddress
  metaVault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVault] SubVaultEjecting metaVault={} subVault={}', [metaVaultAddress.toHex(), subVaultAddress.toHex()])
}

// V2 handlers (SubVaultsRegistry template)
export function handleSubVaultAdded(event: SubVaultAdded): void {
  const metaVaultAddress = getMetaVaultAddress(event.address)

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
