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
  WAD,
} from '../helpers/constants'
import {
  FoxVault as FoxVaultTemplate,
  RewardSplitterFactory as RewardSplitterFactoryTemplate,
  VaultFactory as VaultFactoryTemplate,
} from '../../generated/templates'
import { Allocator, OsTokenHolder, Vault } from '../../generated/schema'
import {
  convertOsTokenSharesToAssets,
  createOrLoadOsToken,
  snapshotOsToken,
  snapshotOsTokenHolder,
  updateOsTokenApy,
  updateOsTokenTotalAssets,
} from '../entities/osToken'
import {
  getAllocatorsMintedShares,
  snapshotAllocator,
  getAllocatorLtv,
  getAllocatorOsTokenMintApy,
  getAllocatorLtvStatus,
} from '../entities/allocator'
import { createOrLoadNetwork, isGnosisNetwork } from '../entities/network'
import { Harvested, RewardsUpdated, ValidatorsApproval, OwnershipTransferred } from '../../generated/Keeper/Keeper'
import { convertSharesToAssets, getVaultStateUpdate, snapshotVault, updateVaultApy } from '../entities/vaults'
import { createOrLoadV2Pool, getPoolStateUpdate, updatePoolApy } from '../entities/v2pool'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { updateExitRequests } from '../entities/exitRequests'
import { updateRewardSplitters } from '../entities/rewardSplitter'
import { updateLeverageStrategyPositions } from '../entities/leverageStrategy'

const IS_PRIVATE_KEY = 'isPrivate'
const IS_ERC20_KEY = 'isErc20'
const IS_BLOCKLIST_KEY = 'isBlocklist'
const IS_RESTAKE_KEY = 'isRestake'

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  const network = createOrLoadNetwork()
  if (network.factoriesInitialized) {
    return
  } else {
    network.factoriesInitialized = true
    network.save()
  }

  const vaultFactoryV1 = Address.fromString(VAULT_FACTORY_V1)
  const vaultFactoryV2 = Address.fromString(VAULT_FACTORY_V2)
  const privVaultFactoryV1 = Address.fromString(PRIV_VAULT_FACTORY_V1)
  const privVaultFactoryV2 = Address.fromString(PRIV_VAULT_FACTORY_V2)
  const blocklistVaultFactoryV2 = Address.fromString(BLOCKLIST_VAULT_FACTORY_V2)
  const erc20VaultFactoryV1 = Address.fromString(ERC20_VAULT_FACTORY_V1)
  const erc20VaultFactoryV2 = Address.fromString(ERC20_VAULT_FACTORY_V2)
  const privErc20VaultFactoryV1 = Address.fromString(PRIV_ERC20_VAULT_FACTORY_V1)
  const privErc20VaultFactoryV2 = Address.fromString(PRIV_ERC20_VAULT_FACTORY_V2)
  const blocklistErc20VaultFactoryV2 = Address.fromString(BLOCKLIST_ERC20_VAULT_FACTORY_V2)
  const restakeVaultFactoryV2 = Address.fromString(RESTAKE_VAULT_FACTORY_V2)
  const restakePrivVaultFactoryV2 = Address.fromString(RESTAKE_PRIV_VAULT_FACTORY_V2)
  const restakeBlocklistVaultFactoryV2 = Address.fromString(RESTAKE_BLOCKLIST_VAULT_FACTORY_V2)
  const restakeErc20VaultFactoryV2 = Address.fromString(RESTAKE_ERC20_VAULT_FACTORY_V2)
  const restakePrivErc20VaultFactoryV2 = Address.fromString(RESTAKE_PRIV_ERC20_VAULT_FACTORY_V2)
  const restakeBlocklistErc20VaultFactoryV2 = Address.fromString(RESTAKE_BLOCKLIST_ERC20_VAULT_FACTORY_V2)
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
  context.setBoolean(IS_RESTAKE_KEY, false)
  if (vaultFactoryV1.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(vaultFactoryV1, context)
    log.info('[Keeper] Initialize VaultFactory V1 at block={}', [blockNumber])
  }
  if (vaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(vaultFactoryV2, context)
    log.info('[Keeper] Initialize VaultFactory V2 at block={}', [blockNumber])
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

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (blocklistVaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(blocklistVaultFactoryV2, context)
    log.info('[Keeper] Initialize BlocklistVaultFactory V2 at block={}', [blockNumber])
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

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (privErc20VaultFactoryV1.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privErc20VaultFactoryV1, context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V1 at block={}', [blockNumber])
  }
  if (privErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(privErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize PrivateERC20VaultFactory V2 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (blocklistErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(blocklistErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize BlocklistERC20VaultFactory V2 at block={}', [blockNumber])
  }

  // create restake vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  context.setBoolean(IS_RESTAKE_KEY, true)
  if (restakeVaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(restakeVaultFactoryV2, context)
    log.info('[Keeper] Initialize RestakeVaultFactory V2 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (restakePrivVaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(restakePrivVaultFactoryV2, context)
    log.info('[Keeper] Initialize RestakePrivateVaultFactory V2 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (restakeBlocklistVaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(restakeBlocklistVaultFactoryV2, context)
    log.info('[Keeper] Initialize RestakeBlocklistVaultFactory V2 at block={}', [blockNumber])
  }

  // create restake erc20 vault factories
  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_ERC20_KEY, true)
  context.setBoolean(IS_BLOCKLIST_KEY, false)
  if (restakeErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(restakeErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize RestakeERC20VaultFactory V2 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, true)
  if (restakePrivErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(restakePrivErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize RestakePrivateERC20VaultFactory V2 at block={}', [blockNumber])
  }

  context.setBoolean(IS_PRIVATE_KEY, false)
  context.setBoolean(IS_BLOCKLIST_KEY, true)
  if (restakeBlocklistErc20VaultFactoryV2.notEqual(zeroAddress)) {
    VaultFactoryTemplate.createWithContext(restakeBlocklistErc20VaultFactoryV2, context)
    log.info('[Keeper] Initialize RestakeBlocklistERC20VaultFactory V2 at block={}', [blockNumber])
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

export function updateRewards(
  value: JSONValue,
  rewardsRoot: Bytes,
  updateTimestamp: BigInt,
  rewardsIpfsHash: string,
  newAvgRewardPerSecond: BigInt,
  block: ethereum.Block,
): void {
  const vaultRewards = value.toObject().mustGet('vaults').toArray()
  const network = createOrLoadNetwork()
  const isGnosis = isGnosisNetwork()
  const v2Pool = createOrLoadV2Pool()

  // process OsToken rewards update
  const osToken = createOrLoadOsToken()
  updateOsTokenApy(osToken, newAvgRewardPerSecond)
  const osTokenTotalAssetsDiff = updateOsTokenTotalAssets(osToken, updateTimestamp, block)
  osToken.save()
  snapshotOsToken(osToken, osTokenTotalAssetsDiff, updateTimestamp)

  // update assets of all the osToken holders
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  let osTokenHolder: OsTokenHolder
  let osTokenAssetsBefore: BigInt
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    if (osTokenHolder.balance.isZero()) {
      continue
    }
    osTokenAssetsBefore = osTokenHolder.assets
    osTokenHolder.assets = convertOsTokenSharesToAssets(osToken, osTokenHolder.balance)
    osTokenHolder.save()
    snapshotOsTokenHolder(osTokenHolder, osTokenHolder.assets.minus(osTokenAssetsBefore), updateTimestamp)
  }

  // process vault rewards
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
    const lockedMevReward = !vault.mevEscrow ? vaultReward.mustGet('locked_mev_reward').toBigInt() : BigInt.zero()
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

    // fetch new principal, total assets and rate
    let newRate: BigInt, newTotalAssets: BigInt, newTotalShares: BigInt, newExitingAssets: BigInt
    if (vault.isGenesis && !v2Pool.migrated) {
      newRate = BigInt.fromString(WAD)
      newTotalAssets = BigInt.zero()
      newTotalShares = BigInt.zero()
      newExitingAssets = BigInt.zero()
    } else {
      const stateUpdate = getVaultStateUpdate(vault, rewardsRoot, proofReward, proofUnlockedMevReward, proof)
      newRate = stateUpdate[0]
      newTotalAssets = stateUpdate[1]
      newTotalShares = stateUpdate[2]
      newExitingAssets = stateUpdate[3]
      updateVaultApy(vault, vault.rewardsTimestamp, updateTimestamp, newRate.minus(vault.rate))
    }

    // calculate smoothing pool penalty
    let slashedMevReward = vault.slashedMevReward
    if (vault.lockedExecutionReward.gt(lockedMevReward) && vault.unlockedExecutionReward.ge(unlockedMevReward)) {
      slashedMevReward = slashedMevReward.plus(vault.lockedExecutionReward.minus(lockedMevReward))
    }

    // update vault
    const maxPercent = BigInt.fromI32(10000)
    const rewardsDiff = vault.totalAssets
      .times(newRate.minus(vault.rate))
      .times(maxPercent.plus(BigInt.fromI32(vault.feePercent)))
      .div(BigInt.fromString(WAD))
      .div(maxPercent)
    network.totalAssets = network.totalAssets.minus(vault.totalAssets).plus(newTotalAssets)
    network.totalEarnedAssets = network.totalEarnedAssets.plus(rewardsDiff)

    vault.totalAssets = newTotalAssets
    vault.totalShares = newTotalShares
    vault.exitingAssets = newExitingAssets
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

    if (!vault.isGenesis || v2Pool.migrated) {
      snapshotVault(vault, rewardsDiff, updateTimestamp)
    }

    // update v2 pool data
    if (vault.isGenesis && v2Pool.migrated) {
      const stateUpdate = getPoolStateUpdate(rewardsRoot, proofReward, proofUnlockedMevReward, proof)
      const newRate = stateUpdate[0]
      const newRewardAssets = stateUpdate[1]
      const newPrincipalAssets = stateUpdate[2]
      const newPenaltyAssets = stateUpdate[3]
      const poolNewTotalAssets = newRewardAssets.plus(newPrincipalAssets).minus(newPenaltyAssets)

      network.totalAssets = network.totalAssets.plus(poolNewTotalAssets).minus(v2Pool.totalAssets)
      updatePoolApy(v2Pool, v2Pool.rewardsTimestamp, updateTimestamp, newRate.minus(v2Pool.rate))
      v2Pool.rate = newRate
      v2Pool.principalAssets = newPrincipalAssets
      v2Pool.rewardAssets = newRewardAssets
      v2Pool.penaltyAssets = newPenaltyAssets
      v2Pool.totalAssets = poolNewTotalAssets
      v2Pool.rewardsTimestamp = updateTimestamp
      v2Pool.save()
    }

    // update allocators
    let allocator: Allocator
    let allocatorAssetsDiff: BigInt
    let allocatorNewAssets: BigInt
    let allocatorNewMintedOsTokenShares: BigInt
    let allocatorMintedOsTokenSharesDiff: BigInt
    let allocators: Array<Allocator> = vault.allocators.load()
    const allocatorsMintedOsTokenShares = getAllocatorsMintedShares(vault, allocators)
    const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      if (allocator.shares.isZero()) {
        continue
      }
      allocatorNewAssets = convertSharesToAssets(vault, allocator.shares)
      allocatorAssetsDiff = allocatorNewAssets.minus(allocator.assets)
      allocator.assets = allocatorNewAssets

      allocatorNewMintedOsTokenShares = allocatorsMintedOsTokenShares[j]
      allocatorMintedOsTokenSharesDiff = allocatorNewMintedOsTokenShares.minus(allocator.mintedOsTokenShares)
      allocator.mintedOsTokenShares = allocatorNewMintedOsTokenShares
      allocator.ltv = getAllocatorLtv(allocator, osToken)
      allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
      allocator.osTokenMintApy = getAllocatorOsTokenMintApy(allocator, osToken.apy, osToken, osTokenConfig)
      allocator.save()
      snapshotAllocator(
        allocator,
        osToken,
        osTokenConfig,
        allocatorAssetsDiff,
        allocatorMintedOsTokenSharesDiff,
        updateTimestamp,
      )
    }

    // update exit requests
    updateExitRequests(vault, block)

    // update reward splitters
    updateRewardSplitters(vault)

    // update leverage strategy positions
    updateLeverageStrategyPositions(vault, vault.rewardsTimestamp as BigInt)
  }
  network.save()
}

export function handleRewardsUpdated(event: RewardsUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond

  let data: Bytes | null = ipfs.cat(rewardsIpfsHash)
  while (data === null) {
    log.warning('[Keeper] RewardsUpdated ipfs.cat failed, retrying', [])
    data = ipfs.cat(rewardsIpfsHash)
  }
  updateRewards(
    json.fromBytes(data as Bytes),
    rewardsRoot,
    updateTimestamp,
    rewardsIpfsHash,
    newAvgRewardPerSecond,
    event.block,
  )
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
  vault.save()
  if (vault.isGenesis) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      v2Pool.migrated = true
      v2Pool.save()
    }
  }
  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
}

export function handleValidatorsApproval(event: ValidatorsApproval): void {
  const vaultAddress = event.params.vault.toHex()
  const vault = Vault.load(vaultAddress)

  if (vault === null) {
    log.error('[Keeper] ValidatorsApproval vault={} not found', [vaultAddress])
    return
  }

  vault.isCollateralized = true
  vault.save()

  log.info('[Keeper] ValidatorsApproval vault={}', [vaultAddress])
}

export function handleExitRequests(block: ethereum.Block): void {
  const network = createOrLoadNetwork()
  let vault: Vault
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    updateExitRequests(vault, block)
  }
  log.info('[ExitRequests] Sync exit requests at block={}', [block.number.toString()])
}
