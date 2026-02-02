import { Address, log } from '@graphprotocol/graph-ts'
import { SubVaultsRegistryMap } from '../../generated/schema'
import {
  SubVaultAdded,
  SubVaultEjected,
  SubVaultsHarvested,
} from '../../generated/templates/SubVaultsRegistry/SubVaultsRegistry'
import { addSubVault, ejectSubVault, harvestSubVaults } from './metaVault'

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

  log.info('[SubVaultsRegistry] SubVaultsHarvested metaVault={} delta={}', [
    metaVaultAddress.toHex(),
    totalAssetsDelta.toString(),
  ])
}
