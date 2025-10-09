import { Address, log } from '@graphprotocol/graph-ts'
import {
  RewardsUpdated as RewardsUpdatedV0,
  RewardsUpdated1 as RewardsUpdatedV1,
  RewardsUpdated2 as RewardsUpdatedV2,
  Transfer as RewardTokenTransfer,
} from '../../generated/V2RewardToken/V2RewardToken'
import { Transfer as StakedTokenTransfer } from '../../generated/V2StakedToken/V2StakedToken'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { createOrLoadNetwork } from '../entities/network'

export function handleRewardsUpdatedV0(event: RewardsUpdatedV0): void {
  const newTotalRewards = event.params.totalRewards
  const pool = createOrLoadV2Pool()

  const rewardsDiff = newTotalRewards.minus(pool.rewardAssets)
  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.plus(rewardsDiff)
  network.totalEarnedAssets = network.totalEarnedAssets.plus(rewardsDiff)
  network.save()

  pool.rewardAssets = newTotalRewards
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V0 totalRewards={}', [newTotalRewards.toString()])
}

export function handleRewardsUpdatedV1(event: RewardsUpdatedV1): void {
  const newTotalRewards = event.params.totalRewards
  const pool = createOrLoadV2Pool()

  const rewardsDiff = newTotalRewards.minus(pool.rewardAssets)
  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.plus(rewardsDiff)
  network.totalEarnedAssets = network.totalEarnedAssets.plus(rewardsDiff)
  network.save()

  pool.rewardAssets = newTotalRewards
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V1 totalRewards={}', [newTotalRewards.toString()])
}

export function handleRewardsUpdatedV2(event: RewardsUpdatedV2): void {
  const pool = createOrLoadV2Pool()
  if (!pool.migrated) {
    const newTotalRewards = event.params.totalRewards

    const rewardsDiff = newTotalRewards.minus(pool.rewardAssets)
    const network = createOrLoadNetwork()
    network.totalAssets = network.totalAssets.plus(rewardsDiff)
    network.totalEarnedAssets = network.totalEarnedAssets.plus(rewardsDiff)
    network.save()

    pool.rewardAssets = newTotalRewards
    pool.save()
    log.info('[V2 Pool] RewardsUpdated V2 rewardAssets={}', [newTotalRewards.toString()])
  }
}

export function handleRewardTokenTransfer(event: RewardTokenTransfer): void {
  const to = event.params.to
  if (!to.equals(Address.zero())) {
    // handle only burn events
    return
  }

  let pool = createOrLoadV2Pool()
  let value = event.params.value
  pool.rewardAssets = pool.rewardAssets.minus(value)
  pool.save()

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.minus(value)
  network.save()

  log.info('[V2 Pool] RewardToken burn amount={}', [value.toString()])
}

export function handleStakedTokenTransfer(event: StakedTokenTransfer): void {
  const from = event.params.from
  const to = event.params.to
  const amount = event.params.value
  const network = createOrLoadNetwork()

  if (from.equals(Address.zero())) {
    network.totalAssets = network.totalAssets.plus(amount)
    log.info('[V2 Pool] StakedToken mint amount={}', [amount.toString()])
  }

  if (to.equals(Address.zero())) {
    network.totalAssets = network.totalAssets.minus(amount)
    log.info('[V2 Pool] StakedToken burn amount={}', [amount.toString()])
  }
  network.save()
}
