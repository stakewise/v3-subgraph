import { Address, BigDecimal, BigInt, DataSourceContext, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Erc20Vault as Erc20VaultTemplate,
  PrivateVault as PrivateVaultTemplate,
  BlocklistVault as BlocklistVaultTemplate,
  RestakeVault as RestakeVaultTemplate,
  OwnMevEscrow as OwnMevEscrowTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { VaultCreated } from '../../generated/templates/VaultFactory/VaultFactory'
import { OsTokenPosition, Vault, VaultsStat } from '../../generated/schema'
import { createOrLoadNetwork } from './network'
import { createTransaction } from './transaction'
import { WAD } from '../helpers/constants'

const vaultsStatId = '1'

export function createVault(
  event: VaultCreated,
  isPrivate: boolean,
  isErc20: boolean,
  isBlocklist: boolean,
  isRestake: boolean,
): void {
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
  vault.keysManager = admin // Deprecated
  vault.depositDataManager = admin
  vault.canHarvest = false
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.unconvertedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.principalAssets = BigInt.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.exitingAssets = BigInt.zero()
  vault.isPrivate = isPrivate
  vault.isBlocklist = isBlocklist
  vault.isRestake = isRestake
  vault.isErc20 = isErc20
  vault.isOsTokenEnabled = !isRestake
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.apySnapshotsCount = BigInt.zero()
  vault.apy = BigDecimal.zero()
  vault.weeklyApy = BigDecimal.zero()
  vault.executionApy = BigDecimal.zero()
  vault.consensusApy = BigDecimal.zero()
  vault.medianApy = BigDecimal.zero()
  vault.medianExecutionApy = BigDecimal.zero()
  vault.medianConsensusApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = BigInt.fromI32(1)

  if (ownMevEscrow != Address.zero()) {
    vault.mevEscrow = event.params.ownMevEscrow
    const context = new DataSourceContext()
    context.setString('vault', vaultAddressHex)
    OwnMevEscrowTemplate.createWithContext(ownMevEscrow, context)
  }

  if (isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = admin
  }

  if (isBlocklist) {
    BlocklistVaultTemplate.create(vaultAddress)
    vault.blocklistManager = admin
  }

  if (isRestake) {
    RestakeVaultTemplate.create(vaultAddress)
    vault.restakeOperatorsManager = admin
    vault.restakeWithdrawalsManager = admin
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
    '[VaultFactory] VaultCreated address={} admin={} mevEscrow={} feePercent={} capacity={} isPrivate={} isErc20={} isBlocklist={} isRestake={}',
    [
      vaultAddressHex,
      admin.toHex(),
      ownMevEscrow.toHex(),
      feePercent.toString(),
      capacity.toString(),
      isPrivate.toString(),
      isErc20.toString(),
      isBlocklist.toString(),
      isRestake.toString(),
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
