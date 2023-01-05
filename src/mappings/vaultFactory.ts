import { Value, BigInt, log, ipfs } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import { Vault as VaultTemplate } from '../../generated/templates'

import { updateMetadata } from '../entities/metadata'


// Event emitted on vault create
const handleVaultCreated = (event: VaultCreated): void => {
  const block = event.block
  const params = event.params.params
  const eventParams = event.params
  const vaultAddress = eventParams.vault

  const vault = new Vault(vaultAddress.toHex())

  // These properties are empty on vault creating
  // they will be updated on future vault events
  vault.allocators = []
  vault.checkpoints = []
  vault.daySnapshots = []
  vault.exitRequests = []
  vault.allocatorActions = []
  vault.totalShares = BigInt.fromI32(0)
  vault.totalAssets = BigInt.fromI32(0)
  vault.queuedShares = BigInt.fromI32(0)
  vault.unclaimedAssets = BigInt.fromI32(0)

  // Properties from event params
  vault.admin = eventParams.admin
  vault.factory = event.address
  vault.createdAt = block.timestamp
  vault.feesEscrow = eventParams.feesEscrow
  vault.feeRecipient = eventParams.admin

  // Properties from event parameter "params"
  vault.capacity = params.capacity
  vault.tokenName = params.name
  vault.feePercent = params.feePercent
  vault.tokenSymbol = params.symbol
  vault.validatorsRoot = params.validatorsRoot
  vault.metadataIpfsHash = params.metadataIpfsHash
  vault.validatorsIpfsHash = params.validatorsIpfsHash

  // Properties will be updated when ipfs metadata fetched
  vault.imageUrl = ''
  vault.tokenName = ''
  vault.description = ''

  vault.save()

  ipfs.mapJSON(params.metadataIpfsHash, 'updateMetadata', Value.fromAddress(vaultAddress))

  VaultTemplate.create(vaultAddress)

  log.info(
    '[VaultFactory] VaultCreated address={} admin={} feesEscrow={} feePercent={} capacity={}',
    [
      eventParams.vault.toHex(),
      eventParams.admin.toHex(),
      eventParams.feesEscrow.toHex(),
      params.feePercent.toString(),
      params.capacity.toString(),
    ]
  )
}


export {
  handleVaultCreated,
}
