import { Address, BigDecimal, BigInt, Bytes, ipfs, json, JSONValue, JSONValueKind, log } from '@graphprotocol/graph-ts'
import { DistributorClaimedAmount, PeriodicDistribution } from '../../generated/schema'
import {
  OneTimeDistributionAdded,
  PeriodicDistributionAdded,
  RewardsClaimed,
  RewardsRootUpdated,
} from '../../generated/MerkleDistributor/MerkleDistributor'
import {
  convertDistributionTypeToString,
  createOrLoadDistributorClaim,
  createOrLoadDistributorReward,
  DistributionType,
  getDistributionType,
  loadDistributor,
  loadDistributorClaim,
} from '../entities/merkleDistributor'
import { createTransaction } from '../entities/transaction'

export function handlePeriodicDistributionAdded(event: PeriodicDistributionAdded): void {
  const distribution = new PeriodicDistribution(
    `${event.transaction.hash.toHex()}-${event.transactionLogIndex.toString()}`,
  )
  const distType = getDistributionType(event.params.extraData)
  if (distType == DistributionType.UNKNOWN) {
    log.error('[MerkleDistributor] Unknown periodic distribution extraData={}', [event.params.extraData.toHex()])
    return
  }

  distribution.distributionType = convertDistributionTypeToString(distType)
  distribution.data = event.params.extraData
  distribution.token = event.params.token
  distribution.amount = event.params.amount
  distribution.startTimestamp = event.block.timestamp.plus(event.params.delayInSeconds)
  distribution.endTimestamp = distribution.startTimestamp.plus(event.params.durationInSeconds)
  distribution.apy = BigDecimal.zero()
  distribution.apys = []
  distribution.save()

  const distributor = loadDistributor()!
  const activeDistributionIds = distributor.activeDistributionIds
  activeDistributionIds.push(distribution.id)
  distributor.activeDistributionIds = activeDistributionIds
  distributor.save()

  log.info('[MerkleDistributor] PeriodicDistributionAdded data={} token={} amount={}', [
    distribution.data.toHexString(),
    distribution.token.toString(),
    distribution.amount.toString(),
  ])
}

export function handleOneTimeDistributionAdded(event: OneTimeDistributionAdded): void {
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const token = event.params.token
  const totalAmountToDistribute = event.params.amount
  let data: Bytes | null = ipfs.cat(rewardsIpfsHash)
  while (data === null) {
    log.warning('[MerkleDistributor] OneTimeDistributionAdded ipfs.cat failed for hash={}, retrying', [rewardsIpfsHash])
    data = ipfs.cat(rewardsIpfsHash)
  }

  const parsedData = json.fromBytes(data as Bytes)
  if (parsedData.kind != JSONValueKind.ARRAY) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded data is not an array for hash={}', [rewardsIpfsHash])
    return
  }

  let totalDistributedAmount = BigInt.zero()
  const userRewards = parsedData.toArray()
  for (let i = 0; i < userRewards.length; i++) {
    const _userReward = userRewards[i]
    if (_userReward.kind != JSONValueKind.OBJECT) {
      log.error('[MerkleDistributor] OneTimeDistributionAdded user data is not an object for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }
    const userReward = _userReward.toObject()
    const _user = userReward.get('address')
    const _amount = userReward.get('amount')
    if (!_user || _user.kind != JSONValueKind.STRING || !_amount || _amount.kind != JSONValueKind.STRING) {
      log.error('[MerkleDistributor] OneTimeDistributionAdded user or amount is invalid for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }

    const user = Address.fromString(_user.toString())
    const amount = BigInt.fromString(_amount.toString())
    if (amount.lt(BigInt.zero())) {
      log.error('[MerkleDistributor] OneTimeDistributionAdded amount is negative for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }

    totalDistributedAmount = totalDistributedAmount.plus(amount)
    if (totalDistributedAmount.gt(totalAmountToDistribute)) {
      log.error(
        '[MerkleDistributor] OneTimeDistributionAdded total distributed amount is greater than total amount for hash={} index={}',
        [rewardsIpfsHash, i.toString()],
      )
      return
    }

    const distributorReward = createOrLoadDistributorReward(token, user)
    distributorReward.cumulativeAmount = distributorReward.cumulativeAmount.plus(amount)
    distributorReward.save()
  }

  log.info('[MerkleDistributor] OneTimeDistributionAdded rewardsIpfsHash={} token={} totalAmountToDistribute={}', [
    rewardsIpfsHash,
    token.toHexString(),
    totalAmountToDistribute.toString(),
  ])
}

export function handleRewardsRootUpdated(event: RewardsRootUpdated): void {
  const rewardsIpfsHash = event.params.newRewardsIpfsHash
  const rewardsRoot = event.params.newRewardsRoot
  let data: Bytes | null = ipfs.cat(rewardsIpfsHash)
  while (data === null) {
    log.warning('[MerkleDistributor] RewardsRootUpdated ipfs.cat failed for hash={}, retrying', [rewardsIpfsHash])
    data = ipfs.cat(rewardsIpfsHash)
  }

  const parsedData = json.fromBytes(data as Bytes)
  if (parsedData.kind != JSONValueKind.ARRAY) {
    log.error('[MerkleDistributor] RewardsRootUpdated data is not an array for hash={}', [rewardsIpfsHash])
    return
  }

  const userRewards = parsedData.toArray()
  for (let i = 0; i < userRewards.length; i++) {
    const _userReward = userRewards[i]
    if (_userReward.kind != JSONValueKind.OBJECT) {
      log.error('[MerkleDistributor] RewardsRootUpdated user data is not an object for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }
    const userReward = _userReward.toObject()
    const _user = userReward.get('address')
    const _tokens = userReward.get('tokens')
    const _amounts = userReward.get('amounts')
    const _proof = userReward.get('proof')
    if (!_user || _user.kind != JSONValueKind.STRING) {
      log.error('[MerkleDistributor] RewardsRootUpdated user is invalid for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }
    if (!_tokens || _tokens.kind != JSONValueKind.ARRAY) {
      log.error('[MerkleDistributor] RewardsRootUpdated tokens is invalid for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }
    if (!_amounts || _amounts.kind != JSONValueKind.ARRAY) {
      log.error('[MerkleDistributor] RewardsRootUpdated amounts is invalid for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }
    if (!_proof || _proof.kind != JSONValueKind.ARRAY) {
      log.error('[MerkleDistributor] RewardsRootUpdated proof is invalid for hash={} index={}', [
        rewardsIpfsHash,
        i.toString(),
      ])
      continue
    }

    const user = Address.fromString(_user.toString())
    const tokens = _tokens.toArray().map<Bytes>((p: JSONValue): Bytes => Bytes.fromHexString(p.toString()))
    const amounts = _amounts.toArray().map<BigInt>((p: JSONValue): BigInt => BigInt.fromString(p.toString()))
    const proof = _proof.toArray().map<string>((p: JSONValue): string => p.toString())

    const unclaimedAmounts: Array<BigInt> = []
    for (let j = 0; j < tokens.length; j++) {
      const claimedAmountId = `${tokens[j].toHex()}-${user.toHex()}`
      const claimedAmount = DistributorClaimedAmount.load(claimedAmountId)
      if (claimedAmount == null) {
        unclaimedAmounts.push(amounts[j])
      } else {
        unclaimedAmounts.push(amounts[j].minus(claimedAmount.cumulativeClaimedAmount))
      }
    }

    const claim = createOrLoadDistributorClaim(user)
    claim.tokens = tokens
    claim.cumulativeAmounts = amounts
    claim.unclaimedAmounts = unclaimedAmounts
    claim.proof = proof
    claim.save()
  }
  log.info('[MerkleDistributor] RewardsRootUpdated rewardsRoot={} rewardsIpfsHash={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
  ])
}

export function handleRewardsClaimed(event: RewardsClaimed): void {
  const user = event.params.account
  const tokens = event.params.tokens
  const cumulativeAmounts = event.params.cumulativeAmounts

  // The DistributorClaim object is guaranteed to exist at this point because
  // the user has claimed rewards using the DistributorClaim object.
  const claim = loadDistributorClaim(user)!
  const unclaimedAmounts = claim.unclaimedAmounts

  for (let i = 0; i < tokens.length; i++) {
    const claimedAmountId = `${tokens[i].toHex()}-${user.toHex()}`
    let claimedAmount = DistributorClaimedAmount.load(claimedAmountId)
    if (claimedAmount == null) {
      claimedAmount = new DistributorClaimedAmount(claimedAmountId)
      claimedAmount.cumulativeClaimedAmount = BigInt.zero()
    }
    claimedAmount.cumulativeClaimedAmount = cumulativeAmounts[i]
    claimedAmount.save()
    unclaimedAmounts[i] = BigInt.zero()
  }

  claim.unclaimedAmounts = unclaimedAmounts
  claim.save()

  createTransaction(event.transaction.hash.toHex())
  log.info('[MerkleDistributor] RewardsClaimed user={}', [user.toHex()])
}
