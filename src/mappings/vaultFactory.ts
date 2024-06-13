import { dataSource } from '@graphprotocol/graph-ts'
import { VaultCreated } from '../../generated/templates/VaultFactory/VaultFactory'
import { createVault } from '../entities/vaults'

export function handleVaultCreated(event: VaultCreated): void {
  let context = dataSource.context()
  let isPrivate = context.getBoolean('isPrivate')
  let isErc20 = context.getBoolean('isErc20')
  let isBlocklist = context.getBoolean('isBlocklist')
  let isRestake = context.getBoolean('isRestake')
  createVault(event, isPrivate, isErc20, isBlocklist, isRestake)
}
