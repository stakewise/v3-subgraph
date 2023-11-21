import { Address, log } from '@graphprotocol/graph-ts'
import { RewardsUpdated as RewardsUpdatedV0 } from '../../generated/V2RewardEthTokenV0/V2RewardEthTokenV0'
import { RewardsUpdated as RewardsUpdatedV1 } from '../../generated/V2RewardEthTokenV1/V2RewardEthTokenV1'
import {
  RewardsUpdated as RewardsUpdatedV2,
  Transfer as RewardEthTokenTransfer,
} from '../../generated/V2RewardEthTokenV2/V2RewardEthTokenV2'
import { Transfer as StakedEthTokenTransfer } from '../../generated/V2StakedEthToken/V2StakedEthToken'
import { createOrLoadV2Pool } from '../entities/v2pool'

export function handleRewardsUpdatedV0(event: RewardsUpdatedV0): void {
  let pool = createOrLoadV2Pool()
  pool.totalRewards = event.params.totalRewards
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V0 totalRewards={}', [pool.totalRewards.toString()])
}

export function handleRewardsUpdatedV1(event: RewardsUpdatedV1): void {
  let pool = createOrLoadV2Pool()
  pool.totalRewards = event.params.totalRewards
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V1 totalRewards={}', [pool.totalRewards.toString()])
}

export function handleRewardsUpdatedV2(event: RewardsUpdatedV2): void {
  let pool = createOrLoadV2Pool()
  pool.totalRewards = event.params.totalRewards
  pool.save()

  log.info('[V2 Pool] RewardsUpdated V2 totalRewards={}', [pool.totalRewards.toString()])
}

export function handleRewardEthTokenTransfer(event: RewardEthTokenTransfer): void {
  const isBurn = event.params.to == Address.zero()
  if (!isBurn) {
    // handle only burn events
    return
  }

  let pool = createOrLoadV2Pool()
  let value = event.params.value
  pool.totalRewards = pool.totalRewards.minus(value)
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
    pool.totalStaked = pool.totalStaked.plus(value)
    log.info('[V2 Pool] StakedEthToken mint amount={}', [value.toString()])
  }

  if (isBurn) {
    pool.totalStaked = pool.totalStaked.minus(value)
    log.info('[V2 Pool] StakedEthToken burn amount={}', [value.toString()])
  }
  pool.save()
}
