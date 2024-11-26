import { Address, ethereum, log } from '@graphprotocol/graph-ts'
import { Distribution, UniswapPool } from '../../generated/schema'
import { DistributionCreated } from '../../generated/MerkleDistributor/MerkleDistributor'
import {
  createOrLoadDistributor,
  distributeToOsTokenUsdcUniPoolUsers,
  distributeToSwiseAssetUniPoolUsers,
} from '../entities/distributor'
import { ASSET_TOKEN, OS_TOKEN, SWISE_TOKEN, USDC_TOKEN } from '../helpers/constants'

export function handleDistributionCreated(event: DistributionCreated): void {
  const target = event.params.target
  if (UniswapPool.load(target) == null) {
    log.error('[Distributor] unknown distribution target {}', [target])
    return
  }

  const blockTimestamp = event.block.timestamp
  const distribution = new Distribution(`${event.transaction.hash.toHex()}-${event.transactionLogIndex.toString()}`)
  distribution.target = target
  distribution.token = event.params.token
  distribution.amount = event.params.amount
  distribution.startTimestamp = blockTimestamp.plus(event.params.delay)
  distribution.endTimestamp = distribution.startTimestamp.plus(event.params.duration)
  distribution.save()

  const distributor = createOrLoadDistributor()
  const activeDistributionIds = distributor.activeDistributionIds
  activeDistributionIds.push(distribution.id)
  distributor.activeDistributionIds = activeDistributionIds
  distributor.save()

  log.info('[Distributor] DistributionCreated target={} token={} amount={}', [
    target,
    distribution.token.toString(),
    distribution.amount.toString(),
  ])
}

export function handleDistributions(block: ethereum.Block): void {
  const distributor = createOrLoadDistributor()
  const activeDistIds = distributor.activeDistributionIds
  if (activeDistIds.length == 0) {
    return
  }
  const currentTimestamp = block.timestamp
  const newActiveDistIds: Array<Distribution> = []

  let dist: Distribution
  for (let i = 0; i < activeDistIds.length; i++) {
    dist = Distribution.load(activeDistIds[i]) as Distribution
    if (dist.startTimestamp.ge(currentTimestamp)) {
      // distribution hasn't started
      newActiveDistIds.push(dist.id)
      continue
    }

    // calculate amount to distribute
    const totalDuration = dist.endTimestamp.minus(dist.startTimestamp)
    let passedDuration = currentTimestamp.minus(dist.startTimestamp)
    if (passedDuration.gt(totalDuration)) {
      passedDuration = totalDuration
    }
    const amountToDistribute = dist.amount.times(passedDuration).div(totalDuration)

    // update distribution
    dist.amount = dist.amount.minus(amountToDistribute)
    dist.startTimestamp = currentTimestamp
    dist.save()
    if (dist.startTimestamp < dist.endTimestamp) {
      newActiveDistIds.push(dist.id)
    }

    // distribute tokens
    const uniPool = UniswapPool.load(dist.target)
    const usdcToken = Address.fromString(USDC_TOKEN)
    const assetToken = Address.fromString(ASSET_TOKEN)
    if (
      uniPool &&
      (uniPool.token0.equals(SWISE_TOKEN) || uniPool.token1.equals(SWISE_TOKEN)) &&
      (uniPool.token0.equals(assetToken) || uniPool.token1.equals(assetToken))
    ) {
      distributeToSwiseAssetUniPoolUsers(uniPool, dist.token, amountToDistribute)
    } else if (
      uniPool &&
      (uniPool.token0.equals(OS_TOKEN) || uniPool.token1.equals(OS_TOKEN)) &&
      (uniPool.token0.equals(usdcToken) || uniPool.token1.equals(usdcToken))
    ) {
      distributeToOsTokenUsdcUniPoolUsers(uniPool, dist.token, amountToDistribute)
    } else {
      assert(false, 'Unknown distribution target {}', [dist.target])
    }
  }

  // update new active distributions
  distributor.activeDistributionIds = newActiveDistIds
  distributor.save()
  log.info('[Distributor] Distributions update block={} timestamp={}', [
    block.number.toString(),
    block.timestamp.toString(),
  ])
}
