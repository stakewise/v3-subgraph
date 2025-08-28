import { Address, log } from '@graphprotocol/graph-ts'
import { Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import {
  DepositDataManagerUpdated,
  DepositDataMigrated,
  DepositDataRootUpdated,
} from '../../generated/DepositDataRegistry/DepositDataRegistry'

export function handleDepositDataManagerUpdated(event: DepositDataManagerUpdated): void {
  const vaultAddress = event.params.vault.toHex()
  const depositDataManager = event.params.depositDataManager

  // Vault must exist at the time of the event
  const vault = Vault.load(vaultAddress)
  if (!vault) {
    log.error('[DepositDataRegistry] DepositDataManagerUpdated vault={} not found', [vaultAddress])
    return
  }
  vault.depositDataManager = depositDataManager
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[DepositDataRegistry] DepositDataManagerUpdated vault={} depositDataManager={}', [
    vaultAddress,
    depositDataManager.toHexString(),
  ])
}

export function handleDepositDataMigrated(event: DepositDataMigrated): void {
  const vaultAddress = event.params.vault.toHex()
  const depositDataRoot = event.params.depositDataRoot
  const depositDataManager = event.params.depositDataManager

  // Vault must exist at the time of the event
  const vault = Vault.load(vaultAddress) as Vault
  vault.depositDataRoot = depositDataRoot

  // zero address is when the default deposit data manager was used (admin)
  if (depositDataManager.equals(Address.zero())) {
    vault.depositDataManager = vault.admin
  } else {
    vault.depositDataManager = depositDataManager
  }
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[DepositDataRegistry] DepositDataMigrated vault={} depositDataRoot={} depositDataManager={}', [
    vaultAddress,
    depositDataRoot.toHexString(),
    depositDataManager.toHexString(),
  ])
}

export function handleDepositDataRootUpdated(event: DepositDataRootUpdated): void {
  const vaultAddress = event.params.vault.toHex()
  const depositDataRoot = event.params.depositDataRoot

  // Vault must exist at the time of the event
  const vault = Vault.load(vaultAddress)
  if (!vault) {
    log.error('[DepositDataRegistry] DepositDataRootUpdated vault={} not found', [vaultAddress])
    return
  }
  vault.depositDataRoot = depositDataRoot
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[DepositDataRegistry] DepositDataRootUpdated vault={} depositDataRoot={}', [
    vaultAddress,
    depositDataRoot.toHexString(),
  ])
}
