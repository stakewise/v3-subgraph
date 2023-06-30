import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { createVault } from '../entities/vaults'

export function handleVaultCreated(event: VaultCreated): void {
  createVault(event, false, false)
}

export function handlePrivVaultCreated(event: VaultCreated): void {
  createVault(event, true, false)
}

export function handleErc20VaultCreated(event: VaultCreated): void {
  createVault(event, false, true)
}

export function handlePrivErc20VaultCreated(event: VaultCreated): void {
  createVault(event, true, true)
}
