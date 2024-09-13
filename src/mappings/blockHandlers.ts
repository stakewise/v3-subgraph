import { Address, BigInt, DataSourceContext, ethereum, log } from '@graphprotocol/graph-ts'
import {
  BLOCKLIST_ERC20_VAULT_FACTORY_V2,
  BLOCKLIST_VAULT_FACTORY_V2,
  ERC20_VAULT_FACTORY_V1,
  ERC20_VAULT_FACTORY_V2,
  FOX_VAULT1,
  FOX_VAULT2,
  PRIV_ERC20_VAULT_FACTORY_V1,
  PRIV_ERC20_VAULT_FACTORY_V2,
  PRIV_VAULT_FACTORY_V1,
  PRIV_VAULT_FACTORY_V2,
  RESTAKE_BLOCKLIST_ERC20_VAULT_FACTORY_V2,
  RESTAKE_BLOCKLIST_VAULT_FACTORY_V2,
  RESTAKE_ERC20_VAULT_FACTORY_V2,
  RESTAKE_PRIV_ERC20_VAULT_FACTORY_V2,
  RESTAKE_PRIV_VAULT_FACTORY_V2,
  RESTAKE_VAULT_FACTORY_V2,
  REWARD_SPLITTER_FACTORY_V1,
  REWARD_SPLITTER_FACTORY_V2,
  VAULT_FACTORY_V1,
  VAULT_FACTORY_V2,
  ZERO_ADDRESS,
} from '../helpers/constants'
import {
  FoxVault as FoxVaultTemplate,
  RewardSplitterFactory as RewardSplitterFactoryTemplate,
  VaultFactory as VaultFactoryTemplate,
} from '../../generated/templates'
import { Vault } from '../../generated/schema'
import { createOrLoadOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { updateExitRequests, updateAllocatorsMintedOsTokenShares } from '../entities/allocator'
import { createOrLoadNetwork } from '../entities/network'

const IS_PRIVATE_KEY = 'isPrivate'
const IS_ERC20_KEY = 'isErc20'
const IS_BLOCKLIST_KEY = 'isBlocklist'
const IS_RESTAKE_KEY = 'isRestake'

export function initialize(block: ethereum.Block): void {
  let context = new DataSourceContext()

  // create non-erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  context.setBoolean(IS_RESTAKE_KEY, false)
  if (VAULT_FACTORY_V1 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(VAULT_FACTORY_V1), context)
    log.info('[Keeper] Initialize VaultFactory V1 at block={}', [block.number.toString()])
  }
  if (VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize VaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (PRIV_VAULT_FACTORY_V1 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(PRIV_VAULT_FACTORY_V1), context)
    log.info('[Keeper] Initialize PrivateVaultFactory V1 at block={}', [block.number.toString()])
  }
  if (PRIV_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(PRIV_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize PrivateVaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (BLOCKLIST_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(BLOCKLIST_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize BlocklistVaultFactory V2 at block={}', [block.number.toString()])
  }

  // create erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, true)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  if (ERC20_VAULT_FACTORY_V1 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(ERC20_VAULT_FACTORY_V1), context)
    log.info('[Keeper] Initialize ERC20VaultFactory V1 at block={}', [block.number.toString()])
  }
  if (ERC20_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(ERC20_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize ERC20VaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (PRIV_ERC20_VAULT_FACTORY_V1 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(PRIV_ERC20_VAULT_FACTORY_V1), context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V1 at block={}', [block.number.toString()])
  }
  if (PRIV_ERC20_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(PRIV_ERC20_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (BLOCKLIST_ERC20_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(BLOCKLIST_ERC20_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize BlocklistERC20VaultFactory V2 at block={}', [block.number.toString()])
  }

  // create restake vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  context.setBoolean(IS_RESTAKE_KEY, true)
  if (RESTAKE_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(RESTAKE_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize RestakeVaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (RESTAKE_PRIV_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(RESTAKE_PRIV_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize RestakePrivateVaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (RESTAKE_BLOCKLIST_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(RESTAKE_BLOCKLIST_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize RestakeBlocklistVaultFactory V2 at block={}', [block.number.toString()])
  }

  // create restake erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, true)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  if (RESTAKE_ERC20_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(RESTAKE_ERC20_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize RestakeERC20VaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (RESTAKE_PRIV_ERC20_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(RESTAKE_PRIV_ERC20_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize RestakePrivateERC20VaultFactory V2 at block={}', [block.number.toString()])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (RESTAKE_BLOCKLIST_ERC20_VAULT_FACTORY_V2 != ZERO_ADDRESS) {
    VaultFactoryTemplate.createWithContext(Address.fromString(RESTAKE_BLOCKLIST_ERC20_VAULT_FACTORY_V2), context)
    log.info('[Keeper] Initialize RestakeBlocklistERC20VaultFactory V2 at block={}', [block.number.toString()])
  }

  // create reward splitter factories
  if (REWARD_SPLITTER_FACTORY_V1 != ZERO_ADDRESS) {
    RewardSplitterFactoryTemplate.create(Address.fromString(REWARD_SPLITTER_FACTORY_V1))
    log.info('[Keeper] Initialize RewardSplitterFactory V1 at block={}', [block.number.toString()])
  }

  if (REWARD_SPLITTER_FACTORY_V2 != ZERO_ADDRESS) {
    RewardSplitterFactoryTemplate.create(Address.fromString(REWARD_SPLITTER_FACTORY_V2))
    log.info('[Keeper] Initialize RewardSplitterFactory V2 at block={}', [block.number.toString()])
  }

  if (FOX_VAULT1 != ZERO_ADDRESS) {
    FoxVaultTemplate.create(Address.fromString(FOX_VAULT1))
    log.info('[Keeper] Initialize FoxVault1 at block={}', [block.number.toString()])
  }

  if (FOX_VAULT2 != ZERO_ADDRESS) {
    FoxVaultTemplate.create(Address.fromString(FOX_VAULT2))
    log.info('[Keeper] Initialize FoxVault2 at block={}', [block.number.toString()])
  }
}

export function syncUpdates(block: ethereum.Block): void {
  const osToken = createOrLoadOsToken()
  updateOsTokenTotalAssets(osToken)
  osToken.save()

  if (osToken.totalSupply.equals(BigInt.zero()) || osToken.totalAssets.equals(BigInt.zero())) {
    return
  }

  const network = createOrLoadNetwork()
  for (let i = 0; i < network.vaultIds.length; i++) {
    const vaultAddr = network.vaultIds[i]
    const vault = Vault.load(vaultAddr) as Vault
    updateAllocatorsMintedOsTokenShares(vault)
    updateExitRequests(vault)
  }
  log.info('[BlockHandlers] Sync updates at block={}', [block.number.toString()])
}
