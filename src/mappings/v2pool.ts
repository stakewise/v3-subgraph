import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import {
  RewardsUpdated as RewardsUpdatedV0,
  RewardsUpdated1 as RewardsUpdatedV1,
  RewardsUpdated2 as RewardsUpdatedV2,
  Transfer as RewardTokenTransfer,
} from '../../generated/V2RewardToken/V2RewardToken'
import { Transfer as StakedTokenTransfer } from '../../generated/V2StakedToken/V2StakedToken'
import { Vault } from '../../generated/schema'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { updatePoolApy, updateVaultApy } from '../entities/apySnapshots'
import { GENESIS_VAULT, WAD } from '../helpers/constants'
import { getConversionRate } from '../entities/network'

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
    // pool hasn't been migrated yet, update V2 rewards
    pool.rewardAssets = event.params.totalRewards
    pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
    pool.save()
    log.info('[V2 Pool] RewardsUpdated V2 rewardAssets={}', [pool.rewardAssets.toString()])
    return
  }

  // calculate period pool and vault rewards
  const vault = Vault.load(GENESIS_VAULT.toHex()) as Vault
  if (pool.rewardsTimestamp !== null && (vault.rewardsTimestamp as BigInt).equals(pool.rewardsTimestamp as BigInt)) {
    // rewards haven't been updated
    log.info('[V2 Pool] RewardsUpdated V2 skipped, rewardsTimestamp={}', [(pool.rewardsTimestamp as BigInt).toString()])
    return
  }
  const totalPrincipal = vault.principalAssets.plus(pool.totalAssets)
  const totalPeriodReward = pool.vaultHarvestDelta as BigInt
  let poolPeriodReward: BigInt
  if (totalPeriodReward.lt(BigInt.zero())) {
    poolPeriodReward = totalPeriodReward.times(pool.totalAssets).div(totalPrincipal)
  } else {
    poolPeriodReward = event.params.periodRewards
  }
  const vaultPeriodReward = totalPeriodReward.minus(poolPeriodReward)

  // skip updating apy if it's the first rewards update
  if (pool.rewardsTimestamp === null) {
    pool.rewardsTimestamp = vault.rewardsTimestamp
    pool.rewardAssets = event.params.totalRewards
    pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
    pool.executionReward = vault.unlockedExecutionReward.plus(vault.lockedExecutionReward)
    pool.consensusReward = vault.consensusReward
    pool.save()

    vault.totalAssets = vault.totalAssets.plus(vaultPeriodReward)
    vault.principalAssets = vault.principalAssets.plus(vaultPeriodReward)
    vault.save()
    return
  }

  const periodConsensusReward = vault.consensusReward.minus(pool.consensusReward as BigInt)
  const periodExecutionReward = vault.unlockedExecutionReward
    .plus(vault.lockedExecutionReward)
    .minus(pool.executionReward as BigInt)

  // update genesis vault
  const executionRewardRate = getConversionRate()
  updateVaultApy(
    vault,
    pool.rewardsTimestamp,
    vault.rewardsTimestamp as BigInt,
    periodConsensusReward.times(vault.principalAssets).div(totalPrincipal),
    periodExecutionReward
      .times(vault.principalAssets)
      .times(executionRewardRate)
      .div(totalPrincipal)
      .div(BigInt.fromString(WAD)),
  )
  vault.totalAssets = vault.totalAssets.plus(vaultPeriodReward)
  vault.principalAssets = vault.principalAssets.plus(vaultPeriodReward)
  vault.save()

  // update pool
  updatePoolApy(
    pool,
    pool.rewardsTimestamp,
    vault.rewardsTimestamp as BigInt,
    periodConsensusReward.times(pool.totalAssets).div(totalPrincipal),
    periodExecutionReward
      .times(pool.totalAssets)
      .times(executionRewardRate)
      .div(totalPrincipal)
      .div(BigInt.fromString(WAD)),
  )
  pool.rewardsTimestamp = vault.rewardsTimestamp
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.executionReward = vault.unlockedExecutionReward.plus(vault.lockedExecutionReward)
  pool.consensusReward = vault.consensusReward
  pool.vaultHarvestDelta = BigInt.zero()
  pool.save()
  log.info('[V2 Pool] RewardsUpdated V2 totalRewards={}', [pool.rewardAssets.toString()])
}

export function handleRewardTokenTransfer(event: RewardTokenTransfer): void {
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

  log.info('[V2 Pool] StakedToken burn amount={}', [value.toString()])
}

export function handleStakedTokenTransfer(event: StakedTokenTransfer): void {
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
    log.info('[V2 Pool] StakedToken mint amount={}', [value.toString()])
  }

  if (isBurn) {
    pool.principalAssets = pool.principalAssets.minus(value)
    log.info('[V2 Pool] StakedToken burn amount={}', [value.toString()])
  }
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.save()
}
