import { Address, BigDecimal, BigInt, Bytes, ethereum, log, store } from '@graphprotocol/graph-ts'
import { SubVault, SubVaultsRegistryMap, Vault } from '../../generated/schema'
import { SubVaultsRegistry as SubVaultsRegistryContract } from '../../generated/templates/SubVaultsRegistry/SubVaultsRegistry'
import { MetaVaultCreated } from '../../generated/templates/MetaVaultFactory/MetaVaultFactory'
import {
  Erc20Vault as Erc20VaultTemplate,
  MetaVault as MetaVaultTemplate,
  PrivateVault as PrivateVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { WAD } from '../helpers/constants'
import { chunkedMulticall, encodeContractCall } from '../helpers/utils'
import { loadNetwork } from './network'
import { loadOsToken } from './osToken'
import { createTransaction } from './transaction'
import { loadVault, syncVault } from './vault'

const totalAssetsSelector = '0x01e1d114'
const totalSharesSelector = '0x3a98ef39'
const convertToAssetsSelector = '0x07a2d13a'
const exitQueueDataSelector = '0x3e1655d3'

export function createMetaVault(event: MetaVaultCreated, version: BigInt, isPrivate: boolean, isErc20: boolean): void {
  const block = event.block
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const vault = new Vault(vaultAddressHex)
  let decodedParams: ethereum.Tuple
  let curator: Address
  let capacity: BigInt
  let feePercent: i32
  let metadataIpfsHash: string

  if (isErc20) {
    decodedParams = (
      ethereum.decode('(address,uint256,uint16,string,string,string)', event.params.params) as ethereum.Value
    ).toTuple()
    curator = decodedParams[0].toAddress()
    capacity = decodedParams[1].toBigInt()
    feePercent = decodedParams[2].toI32()
    vault.tokenName = decodedParams[3].toString()
    vault.tokenSymbol = decodedParams[4].toString()
    metadataIpfsHash = decodedParams[5].toString()
    Erc20VaultTemplate.create(vaultAddress)
  } else {
    decodedParams = (
      ethereum.decode('(address,uint256,uint16,string)', event.params.params) as ethereum.Value
    ).toTuple()
    curator = decodedParams[0].toAddress()
    capacity = decodedParams[1].toBigInt()
    feePercent = decodedParams[2].toI32()
    metadataIpfsHash = decodedParams[3].toString()
  }
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
  vault.isPrivate = isPrivate
  vault.isBlocklist = false
  vault.isErc20 = isErc20
  vault.isMetaVault = true
  vault.isOsTokenEnabled = true
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.baseApy = BigDecimal.zero()
  vault.extraApy = BigDecimal.zero()
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = version
  vault.validatorsManager = Address.zero()
  vault.osTokenConfig = '2'
  vault.metadataIpfsHash = metadataIpfsHash
  vault._periodEarnedAssets = BigInt.zero()
  vault._unclaimedFeeRecipientShares = BigInt.zero()
  vault._prevAllocatorAssets = BigInt.fromString(WAD)

  if (isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = admin
  }

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

  let results = chunkedMulticall(null, calls)
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

export function getMetaVaultAddress(registryAddress: Address): Address {
  const registryMap = SubVaultsRegistryMap.load(registryAddress.toHex())!
  return Address.fromBytes(registryMap.metaVault)
}

export function addSubVault(metaVaultAddress: Address, subVaultAddress: Address): void {
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = new SubVault(subVaultId)
  subVault.metaVault = metaVaultAddress.toHex()
  subVault.subVault = subVaultAddress
  subVault.save()

  const metaVault = loadVault(metaVaultAddress)!
  metaVault.isCollateralized = true
  if (metaVault.pendingMetaSubVault !== null && metaVault.pendingMetaSubVault!.equals(subVaultAddress)) {
    metaVault.pendingMetaSubVault = null
  }
  metaVault.save()
}

export function ejectSubVault(metaVaultAddress: Address, subVaultAddress: Address): void {
  const subVaultId = `${metaVaultAddress.toHex()}-${subVaultAddress.toHex()}`

  const subVault = SubVault.load(subVaultId)
  if (subVault) {
    store.remove('SubVault', subVaultId)
  }

  // Clear ejectingSubVault on meta vault
  const metaVault = loadVault(metaVaultAddress)!
  metaVault.ejectingSubVault = null
  metaVault.save()
}

export function harvestSubVaults(metaVaultAddress: Address, totalAssetsDelta: BigInt, timestamp: BigInt): void {
  const vault = loadVault(metaVaultAddress)!
  const osToken = loadOsToken()!

  // fetch vault state
  const newState = getMetaVaultState(vault)
  const newRate = newState[0]
  const newTotalAssets = newState[1]
  const newTotalShares = newState[2]
  const newQueuedShares = newState[3]
  const newExitingAssets = newState[4]

  const subVaults: Array<SubVault> = vault.subVaults.load()
  if (subVaults.length == 0) {
    log.error('[MetaVault] No sub vaults found for vault {}', [metaVaultAddress.toHex()])
    return
  }
  const subVault = loadVault(Address.fromBytes(subVaults[0].subVault))!

  // update vault
  vault.totalAssets = newTotalAssets
  vault.totalShares = newTotalShares
  vault.queuedShares = newQueuedShares
  vault.exitingAssets = newExitingAssets
  vault.rate = newRate
  vault.rewardsRoot = subVault.rewardsRoot
  if (vault.subVaultsRegistry) {
    const registry = SubVaultsRegistryContract.bind(Address.fromBytes(vault.subVaultsRegistry!))
    vault.canHarvest = registry.canUpdateState()
  } else {
    vault.canHarvest = subVault.canHarvest
  }
  vault.rewardsIpfsHash = subVault.rewardsIpfsHash
  vault.rewardsTimestamp = subVault.rewardsTimestamp
  vault._periodEarnedAssets = vault._periodEarnedAssets.plus(totalAssetsDelta)
  vault.save()

  // TODO: fix fee recipient shares minted

  // update vault allocators, exit requests, reward splitters
  syncVault(loadNetwork()!, osToken, vault, timestamp)
}
