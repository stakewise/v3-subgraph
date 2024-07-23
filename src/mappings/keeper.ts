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
import { updatePoolApy, updateVaultApy } from '../entities/apySnapshots'
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
  REWARD_SPLITTER_FACTORY_V1,
  REWARD_SPLITTER_FACTORY_V2,
  VAULT_FACTORY_V1,
  VAULT_FACTORY_V2,
  RESTAKE_VAULT_FACTORY_V2,
  RESTAKE_PRIV_VAULT_FACTORY_V2,
  RESTAKE_BLOCKLIST_VAULT_FACTORY_V2,
  RESTAKE_ERC20_VAULT_FACTORY_V2,
  RESTAKE_PRIV_ERC20_VAULT_FACTORY_V2,
  RESTAKE_BLOCKLIST_ERC20_VAULT_FACTORY_V2,
  ZERO_ADDRESS,
} from '../helpers/constants'
import { getPoolStateUpdate, getVaultStateUpdate, getVaultTotalAssets, isGnosisNetwork } from '../helpers/utils'
import { createOrLoadVaultsStat } from '../entities/vaults'
import { createOrLoadV2Pool } from '../entities/v2pool'

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

export function updateRewards(
  value: JSONValue,
  rewardsRoot: Bytes,
  updateTimestamp: BigInt,
  rewardsIpfsHash: string,
): void {
  const vaultRewards = value.toObject().mustGet('vaults').toArray()
  const vaultsStat = createOrLoadVaultsStat()
  const isGnosis = isGnosisNetwork()
  const v2Pool = createOrLoadV2Pool()
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
    const proof = vaultReward
      .mustGet('proof')
      .toArray()
      .map<Bytes>((p: JSONValue): Bytes => Bytes.fromHexString(p.toString()) as Bytes)

    // calculate proof values for state update
    let proofReward: BigInt
    let proofUnlockedMevReward: BigInt
    if (vault.mevEscrow !== null) {
      // vault has own mev escrow, proof reward is consensus reward, nothing can be locked
      proofReward = consensusReward
      proofUnlockedMevReward = BigInt.zero()
    } else if (isGnosis) {
      // for gnosis network, execution rewards are received in DAI and must be converted to GNO
      proofReward = consensusReward
      proofUnlockedMevReward = unlockedMevReward
    } else {
      // vault uses shared mev escrow, proof reward is consensus reward + total mev reward
      proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
      proofUnlockedMevReward = unlockedMevReward
    }

    // fetch new principal and total assets
    const stateUpdate = getVaultStateUpdate(vault, rewardsRoot, proofReward, proofUnlockedMevReward, proof)
    const newRate = stateUpdate[0]
    const newTotalAssets = stateUpdate[1]
    const newTotalShares = stateUpdate[2]

    // calculate smoothing pool penalty
    let slashedMevReward = vault.slashedMevReward
    if (vault.lockedExecutionReward.gt(lockedMevReward) && vault.unlockedExecutionReward.ge(unlockedMevReward)) {
      slashedMevReward = slashedMevReward.plus(vault.lockedExecutionReward.minus(lockedMevReward))
    }

    if (!vault.isGenesis || v2Pool.migrated) {
      updateVaultApy(vault, vault.rewardsTimestamp, updateTimestamp, newRate.minus(vault.rate))
    }

    vaultsStat.totalAssets = vaultsStat.totalAssets.minus(vault.totalAssets).plus(newTotalAssets)
    vault.totalAssets = newTotalAssets
    vault.totalShares = newTotalShares
    vault.rate = newRate
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = proofUnlockedMevReward
    vault.consensusReward = consensusReward
    vault.lockedExecutionReward = lockedMevReward
    vault.unlockedExecutionReward = unlockedMevReward
    vault.slashedMevReward = slashedMevReward
    vault.proof = proof.map<string>((proofValue: Bytes) => proofValue.toHexString())
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    vault.canHarvest = true
    vault.save()

    // update v2 pool data
    if (vault.isGenesis && v2Pool.migrated) {
      const stateUpdate = getPoolStateUpdate(rewardsRoot, proofReward, proofUnlockedMevReward, proof)
      const newRate = stateUpdate[0]
      const newRewardAssets = stateUpdate[1]
      const newPrincipalAssets = stateUpdate[2]
      const newPenaltyAssets = stateUpdate[3]
      updatePoolApy(v2Pool, v2Pool.rewardsTimestamp, updateTimestamp, newRate.minus(v2Pool.rate))
      v2Pool.rate = newRate
      v2Pool.principalAssets = newPrincipalAssets
      v2Pool.rewardAssets = newRewardAssets
      v2Pool.penaltyAssets = newPenaltyAssets
      v2Pool.totalAssets = newRewardAssets.plus(newPrincipalAssets).minus(newPenaltyAssets)
      v2Pool.rewardsTimestamp = updateTimestamp
      v2Pool.save()
    }
  }
  vaultsStat.save()
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
  const vaultAddress = event.params.vault.toHex()
  const totalAssetsDelta = event.params.totalAssetsDelta

  const vault = Vault.load(vaultAddress)
  if (vault == null) {
    log.error('[Keeper] Harvested vault={} not found', [vaultAddress])
    return
  }
  vault.canHarvest = (vault.rewardsRoot as Bytes).notEqual(event.params.rewardsRoot)
  if (vault.isGenesis) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      v2Pool.migrated = true
      v2Pool.save()
    }
    vault.principalAssets = getVaultTotalAssets(vault)
  } else {
    vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  }
  vault.save()
  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
}
