import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import {
  RewardsUpdated as RewardsUpdatedV0,
  RewardsUpdated1 as RewardsUpdatedV1,
  RewardsUpdated2 as RewardsUpdatedV2,
  Transfer as RewardTokenTransfer,
} from '../../generated/V2RewardToken/V2RewardToken'
import { Transfer as StakedTokenTransfer } from '../../generated/V2StakedToken/V2StakedToken'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { WAD } from '../helpers/constants'

export function handleRewardsUpdatedV0(event: RewardsUpdatedV0): void {
  let pool = createOrLoadV2Pool()
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.rate = BigInt.fromString(WAD).times(pool.totalAssets).div(pool.principalAssets)
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V0 totalRewards={}', [pool.rewardAssets.toString()])
}

export function handleRewardsUpdatedV1(event: RewardsUpdatedV1): void {
  let pool = createOrLoadV2Pool()
  pool.rewardAssets = event.params.totalRewards
  pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
  pool.rate = BigInt.fromString(WAD).times(pool.totalAssets).div(pool.principalAssets)
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V1 totalRewards={}', [pool.rewardAssets.toString()])
}

export function handleRewardsUpdatedV2(event: RewardsUpdatedV2): void {
  const pool = createOrLoadV2Pool()
  if (!pool.migrated) {
    pool.rewardAssets = event.params.totalRewards
    pool.totalAssets = pool.principalAssets.plus(pool.rewardAssets)
    pool.rate = BigInt.fromString(WAD).times(pool.totalAssets).div(pool.principalAssets)
    pool.save()
  }
  log.info('[V2 Pool] RewardsUpdated V2 rewardAssets={}', [pool.rewardAssets.toString()])
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
  pool.totalAssets = pool.totalAssets.minus(value)
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
    pool.totalAssets = pool.totalAssets.plus(value)
    log.info('[V2 Pool] StakedToken mint amount={}', [value.toString()])
  }

  if (isBurn) {
    pool.principalAssets = pool.principalAssets.minus(value)
    pool.totalAssets = pool.totalAssets.minus(value)
    log.info('[V2 Pool] StakedToken burn amount={}', [value.toString()])
  }
  pool.save()
}
