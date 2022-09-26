import { Address, log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import {
  Transfer,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  ValidatorsRootUpdated
} from '../../generated/templates/Vault/Vault'

import { createOrLoadStaker } from '../entities/staker'


const ADDRESS_ZERO = Address.zero()

const handleVaultTransfer = (event: Transfer): void => {
  const params = event.params

  const from = params.from
  const to = params.to
  const value = params.value
  const vaultAddress = event.address

  const isMint = from.equals(ADDRESS_ZERO)
  const isBurn = to.equals(ADDRESS_ZERO)
  const isQueuedSharesBurn = isBurn && from.equals(vaultAddress)

  // Burn locked shares on staker exit
  if (isQueuedSharesBurn) {
    const vault = Vault.load(vaultAddress.toHex()) as Vault

    vault.queuedShares = vault.queuedShares.minus(value)
    vault.save()
  }

  if (!isMint) {
    const stakerFrom = createOrLoadStaker(from, vaultAddress)

    stakerFrom.shares = stakerFrom.shares.minus(value)
    stakerFrom.save()
  }

  if (!isBurn) {
    const stakerTo = createOrLoadStaker(to, vaultAddress)

    stakerTo.shares = stakerTo.shares.plus(value)
    stakerTo.save()
  }

  log.info(
    '[Vault] Transfer vault={} from={} to={} value={}',
    [
      vaultAddress.toHexString(),
      params.from.toHexString(),
      params.to.toHexString(),
      params.value.toString(),
    ]
  )
}

const handleValidatorsRootUpdated = (event: ValidatorsRootUpdated): void => {
  const params = event.params

  const validatorsRoot = params.newValidatorsRoot
  const validatorsIpfsHash = params.newValidatorsIpfsHash

  const vault = Vault.load(event.address.toHex()) as Vault

  vault.validatorsRoot = validatorsRoot
  vault.validatorsIpfsHash = validatorsIpfsHash

  vault.save()

  log.info(
    '[Vault] ValidatorsRootUpdated validatorsRoot={} validatorsIpfsHash={}',
    [
      validatorsRoot.toHexString(),
      validatorsIpfsHash,
    ]
  )
}

const handleExitQueueEntered = (event: ExitQueueEntered): void => {
  const vault = Vault.load(event.address.toHex()) as Vault

  vault.queuedShares = vault.queuedShares.plus(event.params.shares)
  vault.save()
}

const handleExitedAssetsClaimed = (event: ExitedAssetsClaimed): void => {
  const params = event.params

  const caller = params.caller
  const receiver = params.receiver
  const prevExitQueueId = params.prevExitQueueId
  const newExitQueueId = params.newExitQueueId
  const withdrawnAssets = params.withdrawnAssets

}


export {
  handleVaultTransfer,
  handleExitQueueEntered,
  handleExitedAssetsClaimed,
  handleValidatorsRootUpdated,
}
