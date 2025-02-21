import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  DataSourceContext,
  ipfs,
  json,
  JSONValue,
  log,
} from '@graphprotocol/graph-ts'
import {
  BLOCKLIST_ERC20_VAULT_FACTORY_V2,
  BLOCKLIST_ERC20_VAULT_FACTORY_V3,
  BLOCKLIST_VAULT_FACTORY_V2,
  BLOCKLIST_VAULT_FACTORY_V3,
  ERC20_VAULT_FACTORY_V1,
  ERC20_VAULT_FACTORY_V2,
  ERC20_VAULT_FACTORY_V3,
  FOX_VAULT1,
  FOX_VAULT2,
  PRIV_ERC20_VAULT_FACTORY_V1,
  PRIV_ERC20_VAULT_FACTORY_V2,
  PRIV_ERC20_VAULT_FACTORY_V3,
  PRIV_VAULT_FACTORY_V1,
  PRIV_VAULT_FACTORY_V2,
  PRIV_VAULT_FACTORY_V3,
  REWARD_SPLITTER_FACTORY_V1,
  REWARD_SPLITTER_FACTORY_V2,
  VAULT_FACTORY_V1,
  VAULT_FACTORY_V2,
  VAULT_FACTORY_V3,
} from '../helpers/constants'
import {
  FoxVault as FoxVaultTemplate,
  RewardSplitterFactory as RewardSplitterFactoryTemplate,
  VaultFactory as VaultFactoryTemplate,
} from '../../generated/templates'
import { Allocator, OsTokenHolder } from '../../generated/schema'
import { createOrLoadOsToken, loadOsToken, updateOsTokenApy } from '../entities/osToken'
import { createOrLoadAllocator, getAllocatorApy, updateAllocatorAssets } from '../entities/allocator'
import { createOrLoadNetwork, increaseUserVaultsCount, loadNetwork } from '../entities/network'
import {
  ConfigUpdated,
  Harvested,
  OwnershipTransferred,
  RewardsUpdated,
  ValidatorsApproval,
} from '../../generated/Keeper/Keeper'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { updateExitRequests } from '../entities/exitRequest'
import { updateRewardSplitters } from '../entities/rewardSplitter'
import { updateLeverageStrategyPositions } from '../entities/leverageStrategy'
import { updateOsTokenExitRequests } from '../entities/osTokenVaultEscrow'
import { getVaultState, loadVault, updateVaultMaxBoostApy, updateVaults } from '../entities/vault'
import { getOsTokenHolderApy } from '../entities/osTokenHolder'
import { createOrLoadAave, loadAave, updateAavePositions } from '../entities/aave'
import { createOrLoadDistributor, loadDistributor } from '../entities/merkleDistributor'

const IS_PRIVATE_KEY = 'isPrivate'
const IS_ERC20_KEY = 'isErc20'
const IS_BLOCKLIST_KEY = 'isBlocklist'

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  createOrLoadV2Pool()
  const network = createOrLoadNetwork()
  if (network.factoriesInitialized) {
    return
  } else {
    network.factoriesInitialized = true
    network.save()
  }
  createOrLoadOsToken()
  createOrLoadAave()
  createOrLoadDistributor()

  const vaultFactoryV1 = Address.fromString(VAULT_FACTORY_V1)
  const vaultFactoryV2 = Address.fromString(VAULT_FACTORY_V2)
  const vaultFactoryV3 = Address.fromString(VAULT_FACTORY_V3)
  const privVaultFactoryV1 = Address.fromString(PRIV_VAULT_FACTORY_V1)
  const privVaultFactoryV2 = Address.fromString(PRIV_VAULT_FACTORY_V2)
  const privVaultFactoryV3 = Address.fromString(PRIV_VAULT_FACTORY_V3)
  const blocklistVaultFactoryV2 = Address.fromString(BLOCKLIST_VAULT_FACTORY_V2)
  const blocklistVaultFactoryV3 = Address.fromString(BLOCKLIST_VAULT_FACTORY_V3)
  const erc20VaultFactoryV1 = Address.fromString(ERC20_VAULT_FACTORY_V1)
  const erc20VaultFactoryV2 = Address.fromString(ERC20_VAULT_FACTORY_V2)
  const erc20VaultFactoryV3 = Address.fromString(ERC20_VAULT_FACTORY_V3)
  const privErc20VaultFactoryV1 = Address.fromString(PRIV_ERC20_VAULT_FACTORY_V1)
  const privErc20VaultFactoryV2 = Address.fromString(PRIV_ERC20_VAULT_FACTORY_V2)
  const privErc20VaultFactoryV3 = Address.fromString(PRIV_ERC20_VAULT_FACTORY_V3)
  const blocklistErc20VaultFactoryV2 = Address.fromString(BLOCKLIST_ERC20_VAULT_FACTORY_V2)
  const blocklistErc20VaultFactoryV3 = Address.fromString(BLOCKLIST_ERC20_VAULT_FACTORY_V3)
  const rewardSplitterFactoryV1 = Address.fromString(REWARD_SPLITTER_FACTORY_V1)
  const rewardSplitterFactoryV2 = Address.fromString(REWARD_SPLITTER_FACTORY_V2)
  const foxVault1 = Address.fromString(FOX_VAULT1)
  const foxVault2 = Address.fromString(FOX_VAULT2)
  const zeroAddress = Address.zero()
  const blockNumber = event.block.number.toString()

  let context = new DataSourceContext()

  // create non-erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  if (vaultFactoryV1.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(vaultFactoryV1, context)
    log.info('[Keeper] Initialize VaultFactory V1 at block={}', [blockNumber])
  }
  if (vaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(vaultFactoryV2, context)
    log.info('[Keeper] Initialize VaultFactory V2 at block={}', [blockNumber])
  }
  if (vaultFactoryV3.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(vaultFactoryV3, context)
    log.info('[Keeper] Initialize VaultFactory V3 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (privVaultFactoryV1.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privVaultFactoryV1, context)
    log.info('[Keeper] Initialize PrivateVaultFactory V1 at block={}', [blockNumber])
  }
  if (privVaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privVaultFactoryV2, context)
    log.info('[Keeper] Initialize PrivateVaultFactory V2 at block={}', [blockNumber])
  }
  if (privVaultFactoryV3.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privVaultFactoryV3, context)
    log.info('[Keeper] Initialize PrivateVaultFactory V3 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (blocklistVaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(blocklistVaultFactoryV2, context)
    log.info('[Keeper] Initialize BlocklistVaultFactory V2 at block={}', [blockNumber])
  }
  if (blocklistVaultFactoryV3.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(blocklistVaultFactoryV3, context)
    log.info('[Keeper] Initialize BlocklistVaultFactory V3 at block={}', [blockNumber])
  }

  // create erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, true)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  if (erc20VaultFactoryV1.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(erc20VaultFactoryV1, context)
    log.info('[Keeper] Initialize ERC20VaultFactory V1 at block={}', [blockNumber])
  }
  if (erc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(erc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize ERC20VaultFactory V2 at block={}', [blockNumber])
  }
  if (erc20VaultFactoryV3.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(erc20VaultFactoryV3, context)
    log.info('[Keeper] Initialize ERC20VaultFactory V3 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (privErc20VaultFactoryV1.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privErc20VaultFactoryV1, context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V1 at block={}', [blockNumber])
  }
  if (privErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V2 at block={}', [blockNumber])
  }
  if (privErc20VaultFactoryV3.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privErc20VaultFactoryV3, context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V3 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (blocklistErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(blocklistErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize BlocklistERC20VaultFactory V2 at block={}', [blockNumber])
  }
  if (blocklistErc20VaultFactoryV3.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(blocklistErc20VaultFactoryV3, context)
    log.info('[Keeper] Initialize BlocklistERC20VaultFactory V3 at block={}', [blockNumber])
  }

  // create reward splitter factories
  if (rewardSplitterFactoryV1.notEqual(zeroAddress)) {
    RewardSplitterFactoryTemplate.create(rewardSplitterFactoryV1)
    log.info('[Keeper] Initialize RewardSplitterFactory V1 at block={}', [blockNumber])
  }

  if (rewardSplitterFactoryV2.notEqual(zeroAddress)) {
    RewardSplitterFactoryTemplate.create(rewardSplitterFactoryV2)
    log.info('[Keeper] Initialize RewardSplitterFactory V2 at block={}', [blockNumber])
  }

  if (foxVault1.notEqual(zeroAddress)) {
    FoxVaultTemplate.create(foxVault1)
    log.info('[Keeper] Initialize FoxVault1 at block={}', [blockNumber])
  }

  if (foxVault2.notEqual(zeroAddress)) {
    FoxVaultTemplate.create(foxVault2)
    log.info('[Keeper] Initialize FoxVault2 at block={}', [blockNumber])
  }

  log.info('[Keeper] Initialize hook complete at block={}', [blockNumber])
}

export function handleRewardsUpdated(event: RewardsUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp
  const blockTimestamp = event.block.timestamp
  const blockNumber = event.block.number
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond

  // update vaults
  let data: Bytes | null = ipfs.cat(rewardsIpfsHash)
  while (!data) {
    log.warning('[Keeper] RewardsUpdated ipfs.cat failed for hash={} retrying', [rewardsIpfsHash])
    data = ipfs.cat(rewardsIpfsHash)
  }
  const feeRecipientsEarnedShares = updateVaults(json.fromBytes(data!), rewardsRoot, updateTimestamp, rewardsIpfsHash)

  // fetch Aave data
  const aave = loadAave()!
  updateAavePositions(aave)

  // update OsToken
  const osToken = loadOsToken()!
  updateOsTokenApy(osToken, newAvgRewardPerSecond)

  const network = loadNetwork()!
  const distributor = loadDistributor()!
  const vaultIds = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    const vaultAddress = Address.fromString(vaultIds[i])
    const vault = loadVault(vaultAddress)
    if (!vault) {
      log.error('[Keeper] RewardsUpdated vault={} not found', [vaultAddress.toHex()])
      continue
    }

    const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)
    if (!osTokenConfig) {
      log.error('[Keeper] RewardsUpdated osTokenConfig={} not found for vault={}', [
        vault.osTokenConfig,
        vaultAddress.toHex(),
      ])
      continue
    }

    // process fee recipient earned shares
    const feeRecipient = createOrLoadAllocator(Address.fromBytes(vault.feeRecipient), vaultAddress)
    const feeRecipientShares = feeRecipientsEarnedShares.get(feeRecipient.id)
    if (feeRecipientShares && feeRecipientShares.gt(BigInt.zero())) {
      if (feeRecipient.shares.isZero()) {
        increaseUserVaultsCount(feeRecipient.address)
      }
      feeRecipient.shares = feeRecipient.shares.plus(feeRecipientShares)
      feeRecipient.save()
    }

    // update allocators
    let earnedAssets: BigInt
    let allocator: Allocator
    let allocators: Array<Allocator> = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      earnedAssets = updateAllocatorAssets(osToken, osTokenConfig, vault, allocator)
      allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(earnedAssets)
      allocator.save()
    }

    // update exit requests
    updateExitRequests(network, vault, updateTimestamp)

    // update reward splitters
    updateRewardSplitters(vault)

    // update OsToken exit requests
    updateOsTokenExitRequests(osToken, vault)

    // update leverage strategy positions
    updateLeverageStrategyPositions(network, aave, osToken, vault)

    // update allocators apys
    let allocatorApy: BigDecimal
    // reload allocators in case they were updated
    allocators = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      allocatorApy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator)
      if (allocatorApy.equals(allocator.apy)) {
        continue
      }
      allocator.apy = allocatorApy
      allocator.save()
    }

    // update vault max boost apys
    updateVaultMaxBoostApy(aave, osToken, vault, osTokenConfig, distributor, blockNumber)
  }

  // update osToken holders apys
  let osTokenHolderApy: BigDecimal
  let osTokenHolder: OsTokenHolder
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    osTokenHolderApy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder)
    if (osTokenHolderApy.equals(osTokenHolder.apy)) {
      continue
    }
    osTokenHolder.apy = osTokenHolderApy
    osTokenHolder.save()
  }

  log.info('[Keeper] RewardsUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={} blockTimestamp={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
    updateTimestamp.toString(),
    blockTimestamp.toString(),
  ])
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  const vaultAddress = event.params.vault
  const totalAssetsDelta = event.params.totalAssetsDelta

  const vault = loadVault(vaultAddress)
  if (vault == null) {
    log.error('[Keeper] Harvested vault={} not found', [vaultAddress.toHex()])
    return
  }
  vault.canHarvest = vault.rewardsRoot!.notEqual(event.params.rewardsRoot)
  if (vault.canHarvest) {
    const state = getVaultState(vault)
    vault._unclaimedFeeRecipientShares = state[5]
  } else {
    vault._unclaimedFeeRecipientShares = BigInt.zero()
  }
  vault.save()
  if (vault.isGenesis) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      v2Pool.migrated = true
      v2Pool.save()
    }
  }
  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress.toHex(), totalAssetsDelta.toString()])
}

export function handleValidatorsApproval(event: ValidatorsApproval): void {
  const vaultAddress = event.params.vault
  const vault = loadVault(vaultAddress)

  if (vault === null) {
    log.error('[Keeper] ValidatorsApproval vault={} not found', [vaultAddress.toHex()])
    return
  }

  vault.isCollateralized = true
  vault.save()

  log.info('[Keeper] ValidatorsApproval vault={}', [vaultAddress.toHex()])
}

export function handleConfigUpdated(event: ConfigUpdated): void {
  const configIpfsHash = event.params.configIpfsHash
  const network = loadNetwork()!

  let data: Bytes | null = ipfs.cat(configIpfsHash)
  while (data === null) {
    log.warning('[Keeper] ConfigUpdated ipfs.cat failed for hash={}, retrying', [configIpfsHash])
    data = ipfs.cat(configIpfsHash)
  }
  const config = json.fromBytes(data as Bytes)
  let osTokenVaultIds: Array<string> = []
  let osTokenVaultsValue = config.toObject().get('os_token_vaults')
  if (osTokenVaultsValue !== null) {
    osTokenVaultIds = osTokenVaultsValue.toArray().map<string>((id: JSONValue): string => id.toString().toLowerCase())
  }

  network.osTokenVaultIds = osTokenVaultIds
  network.oraclesConfigIpfsHash = configIpfsHash
  network.save()

  const osToken = loadOsToken()!
  const distributor = loadDistributor()!
  const holders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < holders.length; i++) {
    const holder = holders[i]
    holder.apy = getOsTokenHolderApy(network, osToken, distributor, holder)
    holder.save()
  }

  log.info('[Keeper] ConfigUpdated configIpfsHash={}', [configIpfsHash])
}
