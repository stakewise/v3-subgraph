import { dataSource } from '@graphprotocol/graph-ts'
import { MetaVaultCreated } from '../../generated/templates/MetaVaultFactory/MetaVaultFactory'
import { createMetaVault } from '../entities/metaVault'

export function handleMetaVaultCreated(event: MetaVaultCreated): void {
  let context = dataSource.context()
  let version = context.getBigInt('version')
  let isPrivate = context.getBoolean('isPrivate')
  let isErc20 = context.getBoolean('isErc20')
  createMetaVault(event, version, isPrivate, isErc20)
}
