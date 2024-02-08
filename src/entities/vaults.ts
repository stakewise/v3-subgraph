import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { VaultCreated } from '../../generated/VaultFactory/VaultFactory'
import {
  Erc20Vault as Erc20VaultTemplate,
  PrivateVault as PrivateVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { OsTokenPosition, Vault, VaultsStat } from '../../generated/schema'
import { createOrLoadNetwork } from './network'
import { createTransaction } from './transaction'

const vaultsStatId = '1'

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
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.unclaimedAssets = BigInt.zero()
  vault.principalAssets = BigInt.zero()
  vault.isPrivate = isPrivate
  vault.isBlocklist = false
  vault.isErc20 = isErc20
  vault.isOsTokenEnabled = true
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.apySnapshotsCount = BigInt.zero()
  vault.weeklyApy = BigDecimal.zero()
  vault.apy = BigDecimal.zero()
  vault.executionApy = BigDecimal.zero()
  vault.consensusApy = BigDecimal.zero()
  vault.isGenesis = false

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

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.vaultsCount = vaultsStat.vaultsCount.plus(BigInt.fromI32(1))
  vaultsStat.save()

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

export function createOrLoadVaultsStat(): VaultsStat {
  let vaultsStat = VaultsStat.load(vaultsStatId)
  if (vaultsStat === null) {
    vaultsStat = new VaultsStat(vaultsStatId)
    vaultsStat.totalAssets = BigInt.zero()
    vaultsStat.vaultsCount = BigInt.zero()
    vaultsStat.save()
  }

  return vaultsStat
}
