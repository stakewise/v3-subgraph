import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { Vault } from '../../generated/schema'
import { MetaVaultCreated } from '../../generated/templates/MetaVaultFactory/MetaVaultFactory'
import { MetaVault as MetaVaultTemplate, Vault as VaultTemplate } from '../../generated/templates'
import { WAD } from '../helpers/constants'
import { chunkedMulticall, encodeContractCall } from '../helpers/utils'
import { loadNetwork } from './network'
import { createTransaction } from './transaction'

const totalAssetsSelector = '0x01e1d114'
const totalSharesSelector = '0x3a98ef39'
const convertToAssetsSelector = '0x07a2d13a'
const exitQueueDataSelector = '0x3e1655d3'

export function createMetaVault(event: MetaVaultCreated, version: BigInt): void {
  const block = event.block
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const vault = new Vault(vaultAddressHex)
  let decodedParams = (
    ethereum.decode('(address,uint256,uint16,string)', event.params.params) as ethereum.Value
  ).toTuple()
  const curator = decodedParams[0].toAddress()
  const capacity = decodedParams[1].toBigInt()
  const feePercent = decodedParams[2].toI32()
  const metadataIpfsHash = decodedParams[3].toString()
  const admin = event.params.admin

  vault.factory = event.address
  vault.admin = admin
  vault.capacity = capacity
  vault.feePercent = feePercent
  vault.feeRecipient = admin
  vault.depositDataManager = Address.zero()
  vault.canHarvest = false
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.isPrivate = false
  vault.isBlocklist = false
  vault.isErc20 = false
  vault.isMetaVault = true
  vault.isOsTokenEnabled = true
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.lastXdaiSwappedTimestamp = block.timestamp
  vault._unclaimedFeeRecipientShares = BigInt.zero()
  vault.baseApy = BigDecimal.zero()
  vault.baseApys = []
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.osTokenHolderMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = version
  vault.lastFeeUpdateTimestamp = block.timestamp
  vault.validatorsManager = Address.zero()
  vault.osTokenConfig = '2'
  vault.metadataIpfsHash = metadataIpfsHash
  vault.save()

  VaultTemplate.create(vaultAddress)
  MetaVaultTemplate.create(vaultAddress)

  const network = loadNetwork()!
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.vaultsCount = network.vaultsCount + 1
  network.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[MetaVaultFactory] MetaVaultCreated address={} admin={} feePercent={} capacity={} curator={}', [
    vaultAddressHex,
    admin.toHex(),
    feePercent.toString(),
    capacity.toString(),
    curator.toHexString(),
  ])
}

export function getMetaVaultState(vault: Vault): Array<BigInt> {
  const vaultAddr = Address.fromString(vault.id)
  const calls: Array<ethereum.Value> = [
    encodeContractCall(vaultAddr, _getConvertToAssetsCall(BigInt.fromString(WAD))),
    encodeContractCall(vaultAddr, Bytes.fromHexString(totalAssetsSelector)),
    encodeContractCall(vaultAddr, Bytes.fromHexString(totalSharesSelector)),
    encodeContractCall(vaultAddr, Bytes.fromHexString(exitQueueDataSelector)),
  ]

  let results = chunkedMulticall([], calls)
  const newRate = ethereum.decode('uint256', results[0]!)!.toBigInt()
  const totalAssets = ethereum.decode('uint256', results[1]!)!.toBigInt()
  const totalShares = ethereum.decode('uint256', results[2]!)!.toBigInt()
  const exitQueueData = ethereum.decode('(uint128,uint128,uint128,uint128,uint256)', results[3]!)!.toTuple()
  const queuedShares = exitQueueData[0].toBigInt()
  const exitingAssets = exitQueueData[3].toBigInt()

  return [newRate, totalAssets, totalShares, queuedShares, exitingAssets]
}

function _getConvertToAssetsCall(shares: BigInt): Bytes {
  const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(shares))
  return Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
}
