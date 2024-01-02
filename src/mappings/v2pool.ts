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

  // TODO: move to constants generated for the network
  const vault = Vault.load('0xac0f906e433d58fa868f936e8a43230473652885') as Vault
  const newTotalReward: BigInt = vault.consensusReward
    .plus(vault.unlockedExecutionReward)
    .plus(vault.lockedExecutionReward)
  let prevTotalReward: BigInt
  if (pool.rewardsTimestamp === null) {
    // deduct all the rewards accumulated in v2
    prevTotalReward = pool.rewardAssets
  } else {
    prevTotalReward = pool.totalReward as BigInt
  }
  const totalPeriodReward = newTotalReward.minus(prevTotalReward)

  // calculate period reward
  let poolPeriodReward: BigInt
  if (totalPeriodReward.lt(BigInt.zero())) {
    // calculate penalties
    const v2PoolPrincipal = pool.totalAssets
    const genesisVaultPrincipal = vault.principalAssets
    const totalPrincipal = genesisVaultPrincipal.plus(v2PoolPrincipal)
    poolPeriodReward = totalPeriodReward.times(v2PoolPrincipal).div(totalPrincipal)
  } else {
    poolPeriodReward = event.params.periodRewards
  }
  const vaultPeriodReward = totalPeriodReward.minus(poolPeriodReward)

  // update genesis vault
  // TODO: fix execution reward calculation
  updateVaultApy(vault, pool.rewardsTimestamp, vault.rewardsTimestamp as BigInt, vaultPeriodReward, BigInt.fromI32(0))
  vault.totalAssets = vault.totalAssets.plus(vaultPeriodReward)
  vault.principalAssets = vault.principalAssets.plus(vaultPeriodReward)
  vault.save()

  // update pool
  updatePoolApy(pool, pool.rewardsTimestamp, vault.rewardsTimestamp as BigInt, poolPeriodReward, BigInt.fromI32(0))
  pool.rewardsTimestamp = vault.rewardsTimestamp
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.totalReward = newTotalReward
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
