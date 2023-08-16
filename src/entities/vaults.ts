import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import {
  Vault as VaultTemplate,
  PrivateVault as PrivateVaultTemplate,
  Erc20Vault as Erc20VaultTemplate,
} from '../../generated/templates'
import { Vault, OsTokenPosition } from '../../generated/schema'
import { createOrLoadNetwork } from './network'
import { createTransaction } from './transaction'

export function createVault(event: VaultCreated, isPrivate: boolean, isErc20: boolean): void {
  const block = event.block
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const vault = new Vault(vaultAddressHex)
  let decodedParams: ethereum.Tuple
  if (isErc20) {
    decodedParams = (
      ethereum.decode('(uint256,uint16,string,string,string)', event.params.params) as ethereum.Value
    ).toTuple()
    vault.tokenName = decodedParams[2].toString()
    vault.tokenSymbol = decodedParams[3].toString()
    Erc20VaultTemplate.create(vaultAddress)
  } else {
    decodedParams = (ethereum.decode('(uint256,uint16,string)', event.params.params) as ethereum.Value).toTuple()
  }
  const capacity = decodedParams[0].toBigInt()
  const feePercent = decodedParams[1].toI32()
  const admin = event.params.admin
  const ownMevEscrow = event.params.ownMevEscrow

  vault.factory = event.address
  vault.admin = admin
  vault.capacity = capacity
  vault.feePercent = feePercent
  vault.feeRecipient = admin
  vault.keysManager = admin
  vault.avgRewardPerAsset = BigDecimal.zero()
  vault.totalShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.verified = false
  vault.totalAssets = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.unclaimedAssets = BigInt.zero()
  vault.principalAssets = BigInt.zero()
  vault.isPrivate = isPrivate
  vault.isErc20 = isErc20
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp

  if (ownMevEscrow != Address.zero()) {
    vault.mevEscrow = event.params.ownMevEscrow
  }

  if (vault.isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = admin
  }

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  network.vaultsTotal = network.vaultsTotal + 1
  network.save()

  createTransaction(event.transaction.hash.toHex())

  log.info(
    '[VaultFactory] VaultCreated address={} admin={} mevEscrow={} feePercent={} capacity={} isPrivate={} isErc20={}',
    [
      vaultAddressHex,
      admin.toHex(),
      ownMevEscrow.toHex(),
      feePercent.toString(),
      capacity.toString(),
      isPrivate.toString(),
      isErc20.toString(),
    ],
  )
}

export function createOrLoadOsTokenPosition(holder: Address, vaultAddress: Address): OsTokenPosition {
  const osTokenPositionId = `${vaultAddress.toHex()}-${holder.toHex()}`

  let osTokenPosition = OsTokenPosition.load(osTokenPositionId)
  if (osTokenPosition === null) {
    osTokenPosition = new OsTokenPosition(osTokenPositionId)
    osTokenPosition.shares = BigInt.zero()
    osTokenPosition.address = holder
    osTokenPosition.vault = vaultAddress.toHex()
    osTokenPosition.save()
  }

  return osTokenPosition
}
