import { Address, log } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Transfer, ValidatorsRootUpdated } from '../../generated/templates/Vault/Vault'

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
    '[Vault] Transfer from={} to={} value={}',
    [
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


export {
  handleVaultTransfer,
  handleValidatorsRootUpdated,
}
