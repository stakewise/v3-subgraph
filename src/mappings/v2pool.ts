import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import { RewardsUpdated as RewardsUpdatedV0 } from '../../generated/V2RewardEthTokenV0/V2RewardEthTokenV0'
import { RewardsUpdated as RewardsUpdatedV1 } from '../../generated/V2RewardEthTokenV1/V2RewardEthTokenV1'
import {
  RewardsUpdated as RewardsUpdatedV2,
  Transfer as RewardEthTokenTransfer,
} from '../../generated/V2RewardEthTokenV2/V2RewardEthTokenV2'
import { Transfer as StakedEthTokenTransfer } from '../../generated/V2StakedEthToken/V2StakedEthToken'
import { Vault } from '../../generated/schema'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { updatePoolApy, updateVaultApy } from '../entities/apySnapshots'
import { GENESIS_VAULT } from '../helpers/constants'

export function handleRewardsUpdatedV0(event: RewardsUpdatedV0): void {
  let pool = createOrLoadV2Pool()
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V0 totalRewards={}', [pool.rewardAssets.toString()])
}

export function handleRewardsUpdatedV1(event: RewardsUpdatedV1): void {
  let pool = createOrLoadV2Pool()
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V1 totalRewards={}', [pool.rewardAssets.toString()])
}

export function handleRewardsUpdatedV2(event: RewardsUpdatedV2): void {
  let pool = createOrLoadV2Pool()
  if (!pool.migrated) {
    pool.rewardAssets = event.params.totalRewards
    pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
    pool.save()
    log.info('[V2 Pool] RewardsUpdated V2 rewardAssets={}', [pool.rewardAssets.toString()])
    return
  }

  const vault = Vault.load(GENESIS_VAULT.toHex()) as Vault
  const newConsensusReward = vault.consensusReward
  const newExecutionReward = vault.unlockedExecutionReward.plus(vault.lockedExecutionReward)
  let prevConsensusReward: BigInt, prevExecutionReward: BigInt
  if (pool.rewardsTimestamp === null) {
    const newTotalReward = newConsensusReward.plus(newExecutionReward)
    prevConsensusReward = pool.rewardAssets.times(newConsensusReward).div(newTotalReward)
    prevExecutionReward = pool.rewardAssets.minus(prevConsensusReward)
  } else if ((vault.rewardsTimestamp as BigInt).equals(pool.rewardsTimestamp as BigInt)) {
    // skip state update for harvested vault
    log.warning('[V2 Pool] state update for harvested vault', [])
    return
  } else {
    prevExecutionReward = pool.executionReward as BigInt
    prevConsensusReward = pool.consensusReward as BigInt
  }

  // calculate principal assets
  const v2PoolPrincipal = pool.totalAssets
  const genesisVaultPrincipal = vault.principalAssets
  const totalPrincipal = genesisVaultPrincipal.plus(v2PoolPrincipal)

  // calculate period rewards
  const totalPeriodReward = newConsensusReward
    .plus(newExecutionReward)
    .minus(prevConsensusReward)
    .minus(prevExecutionReward)
  const v2PoolPeriodReward = event.params.periodRewards
  const vaultPeriodReward = totalPeriodReward.minus(v2PoolPeriodReward)

  // update genesis vault
  updateVaultApy(
    vault,
    pool.rewardsTimestamp,
    vault.rewardsTimestamp as BigInt,
    newConsensusReward.minus(prevConsensusReward).times(genesisVaultPrincipal).div(totalPrincipal),
    newExecutionReward.minus(prevExecutionReward).times(genesisVaultPrincipal).div(totalPrincipal),
  )
  vault.totalAssets = vault.totalAssets.plus(vaultPeriodReward)
  vault.principalAssets = vault.principalAssets.plus(vaultPeriodReward)
  vault.save()

  // update pool
  updatePoolApy(
    pool,
    pool.rewardsTimestamp,
    vault.rewardsTimestamp as BigInt,
    newConsensusReward.minus(prevConsensusReward).times(v2PoolPrincipal).div(totalPrincipal),
    newExecutionReward.minus(prevExecutionReward).times(v2PoolPrincipal).div(totalPrincipal),
  )
  pool.rewardsTimestamp = vault.rewardsTimestamp
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.executionReward = newExecutionReward
  pool.consensusReward = newConsensusReward
  pool.save()
  log.info('[V2 Pool] RewardsUpdated V2 totalRewards={}', [pool.rewardAssets.toString()])
}

export function handleRewardEthTokenTransfer(event: RewardEthTokenTransfer): void {
  const isBurn = event.params.to == Address.zero()
  if (!isBurn) {
    // handle only burn events
    return
  }

  let pool = createOrLoadV2Pool()
  let value = event.params.value
  pool.rewardAssets = pool.rewardAssets.minus(value)
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.save()

  log.info('[V2 Pool] StakedEthToken burn amount={}', [value.toString()])
}

export function handleStakedEthTokenTransfer(event: StakedEthTokenTransfer): void {
  const isMint = event.params.from == Address.zero()
  const isBurn = event.params.to == Address.zero()
  if (!(isMint || isBurn)) {
    // handle only mint and burn events
    return
  }

  let pool = createOrLoadV2Pool()
  let value = event.params.value
  if (isMint) {
    pool.principalAssets = pool.principalAssets.plus(value)
    log.info('[V2 Pool] StakedEthToken mint amount={}', [value.toString()])
  }

  if (isBurn) {
    pool.principalAssets = pool.principalAssets.minus(value)
    log.info('[V2 Pool] StakedEthToken burn amount={}', [value.toString()])
  }
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.save()
}
