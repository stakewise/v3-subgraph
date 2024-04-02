import {
  Address,
  BigInt,
  Bytes,
  DataSourceContext,
  ethereum,
  ipfs,
  json,
  JSONValue,
  log,
} from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested, RewardsUpdated } from '../../generated/Keeper/Keeper'
import {
  FoxVault as FoxVaultTemplate,
  RewardSplitterFactory as RewardSplitterFactoryTemplate,
  VaultFactory as VaultFactoryTemplate,
} from '../../generated/templates'
import { updateVaultApy } from '../entities/apySnapshots'
import { createOrLoadV2Pool } from '../entities/v2pool'
import {
  BLOCKLIST_ERC20_VAULT_FACTORY_V2,
  BLOCKLIST_VAULT_FACTORY_V2,
  ERC20_VAULT_FACTORY_V1,
  ERC20_VAULT_FACTORY_V2,
  FOX_VAULT1,
  FOX_VAULT2,
  GNO_USD_PRICE_FEED,
  PRIV_ERC20_VAULT_FACTORY_V1,
  PRIV_ERC20_VAULT_FACTORY_V2,
  PRIV_VAULT_FACTORY_V1,
  PRIV_VAULT_FACTORY_V2,
  REWARD_SPLITTER_FACTORY_V1,
  REWARD_SPLITTER_FACTORY_V2,
  VAULT_FACTORY_V1,
  VAULT_FACTORY_V2,
  WAD,
  ZERO_ADDRESS,
} from '../helpers/constants'
import { getConversionRate } from '../entities/network'

const IS_PRIVATE_KEY = 'isPrivate'
const IS_ERC20_KEY = 'isErc20'
const IS_BLOCKLIST_KEY = 'isBlocklist'

export function initialize(block: ethereum.Block): void {
  let context = new DataSourceContext()

  // create non-erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
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
  }

  if (FOX_VAULT2 != ZERO_ADDRESS) {
    FoxVaultTemplate.create(Address.fromString(FOX_VAULT2))
  }
}

export function updateRewards(
  value: JSONValue,
  rewardsRoot: Bytes,
  updateTimestamp: BigInt,
  rewardsIpfsHash: string,
): void {
  const vaultRewards = value.toObject().mustGet('vaults').toArray()
  const executionRewardRate = getConversionRate()
  for (let i = 0; i < vaultRewards.length; i++) {
    // load vault object
    const vaultReward = vaultRewards[i].toObject()
    const vaultId = vaultReward.mustGet('vault').toString().toLowerCase()
    const vault = Vault.load(vaultId)
    if (!vault) {
      log.error('[Keeper] RewardsUpdated vault={} not found', [vaultId])
      continue
    }

    // extract vault reward data
    const lockedMevReward =
      vault.mevEscrow === null ? vaultReward.mustGet('locked_mev_reward').toBigInt() : BigInt.zero()
    const unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const consensusReward = vaultReward.mustGet('consensus_reward').toBigInt()
    const executionReward = unlockedMevReward.plus(lockedMevReward)
    const proof = vaultReward.mustGet('proof').toArray()

    // calculate period rewards
    let periodConsensusReward: BigInt, periodExecutionReward: BigInt
    if (vault.isGenesis) {
      // period reward is calculated during harvest
      periodConsensusReward = BigInt.zero()
      periodExecutionReward = BigInt.zero()
    } else if (vault.proofReward === null) {
      // the first rewards update, no delta
      periodConsensusReward = consensusReward
      periodExecutionReward = executionReward
    } else {
      // calculate delta from previous update
      periodConsensusReward = consensusReward.minus(vault.consensusReward)
      periodExecutionReward = executionReward.minus(vault.lockedExecutionReward.plus(vault.unlockedExecutionReward))
    }

    // calculate smoothing pool penalty
    let slashedMevReward = vault.slashedMevReward
    if (vault.lockedExecutionReward.gt(lockedMevReward) && vault.unlockedExecutionReward.ge(unlockedMevReward)) {
      slashedMevReward = slashedMevReward.plus(vault.lockedExecutionReward.minus(lockedMevReward))
    }

    // calculate proof values for state update
    let proofReward: BigInt
    let proofUnlockedMevReward: BigInt
    if (vault.mevEscrow !== null) {
      // vault has own mev escrow, proof reward is consensus reward, nothing can be slashed
      proofReward = consensusReward
      slashedMevReward = BigInt.zero()
      proofUnlockedMevReward = BigInt.zero()
    } else {
      // vault uses shared mev escrow, proof reward is consensus reward + total mev reward
      if (GNO_USD_PRICE_FEED == ZERO_ADDRESS) {
        proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
      } else {
        // for gnosis network, execution rewards are received in DAI and converted later by the operator
        proofReward = consensusReward
      }
      proofUnlockedMevReward = unlockedMevReward
    }

    if (!vault.isGenesis) {
      // genesis vault apy is updated during harvest
      updateVaultApy(
        vault,
        vault.rewardsTimestamp,
        updateTimestamp,
        periodConsensusReward,
        periodExecutionReward.times(executionRewardRate).div(BigInt.fromString(WAD)),
      )
    }

    // update vault state
    if (GNO_USD_PRICE_FEED == ZERO_ADDRESS) {
      vault.totalAssets = vault.totalAssets.plus(periodConsensusReward).plus(periodExecutionReward)
    } else {
      // for gnosis network, execution rewards must be converted for GNO before adding them to the total assets
      vault.totalAssets = vault.totalAssets.plus(periodConsensusReward)
    }
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = proofUnlockedMevReward
    vault.consensusReward = consensusReward
    vault.lockedExecutionReward = lockedMevReward
    vault.unlockedExecutionReward = unlockedMevReward
    vault.slashedMevReward = slashedMevReward
    vault.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    vault.save()
  }
}

export function handleRewardsUpdated(event: RewardsUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp

  const data = ipfs.cat(rewardsIpfsHash) as Bytes
  updateRewards(json.fromBytes(data), rewardsRoot, updateTimestamp, rewardsIpfsHash)
  log.info('[Keeper] RewardsUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
    updateTimestamp.toString(),
  ])
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  let totalAssetsDelta = event.params.totalAssetsDelta
  const vaultAddress = event.params.vault.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  if (!vault.isGenesis) {
    vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
    if (vault.totalAssets.lt(vault.principalAssets)) {
      vault.totalAssets = vault.principalAssets
    }
    vault.save()
  } else {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      totalAssetsDelta = totalAssetsDelta.minus(v2Pool.rewardAssets)
      v2Pool.migrated = true
    }
    v2Pool.vaultHarvestDelta = totalAssetsDelta
    v2Pool.save()
  }
  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
}
