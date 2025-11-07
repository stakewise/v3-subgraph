import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  ethereum,
  ipfs,
  json,
  JSONValue,
  JSONValueKind,
  log,
} from '@graphprotocol/graph-ts'
import { DistributorClaimedAmount, PeriodicDistribution } from '../../generated/schema'
import {
  DistributorUpdated,
  OneTimeDistributionAdded,
  PeriodicDistributionAdded,
  RewardsClaimed,
  RewardsRootUpdated,
} from '../../generated/MerkleDistributor/MerkleDistributor'
import {
  convertDistributionTypeToString,
  createOrLoadDistributorClaim,
  createOrLoadDistributorReward,
  distributeToVaultSelectedUsers,
  distributeToVaultUsers,
  DistributionType,
  fetchRewardsData,
  getDistributionType,
  loadDistributor,
  loadDistributorClaim,
  updatePeriodicDistributions,
} from '../entities/merkleDistributor'
import { createTransaction } from '../entities/transaction'
import { isTokenSupported, loadExchangeRate } from '../entities/exchangeRates'
import { loadVault } from '../entities/vault'
import { loadNetwork } from '../entities/network'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { parseIpfsHash } from '../helpers/utils'
import { OS_TOKEN } from '../helpers/constants'

export function handlePeriodicDistributionAdded(event: PeriodicDistributionAdded): void {
  const token = event.params.token
  const extraData = event.params.extraData

  const distType = getDistributionType(extraData)
  if (distType == DistributionType.UNKNOWN) {
    log.error('[MerkleDistributor] PeriodicDistributionAdded unknown periodic distribution extraData={}', [
      extraData.toHex(),
    ])
    return
  }
  if (!isTokenSupported(token)) {
    log.error('[MerkleDistributor] PeriodicDistributionAdded unsupported token={}', [token.toHexString()])
    return
  }

  const startTimestamp = event.block.timestamp.plus(event.params.delayInSeconds)
  const endTimestamp = startTimestamp.plus(event.params.durationInSeconds)

  const distribution = new PeriodicDistribution(`${event.transaction.hash.toHex()}-${event.logIndex.toString()}`)
  distribution.hash = event.transaction.hash
  distribution.distributionType = convertDistributionTypeToString(distType)
  distribution.data = extraData
  distribution.token = token
  distribution.amount = event.params.amount
  distribution.startTimestamp = startTimestamp
  distribution.endTimestamp = endTimestamp
  distribution.apy = BigDecimal.zero()
  distribution.save()

  const distributor = loadDistributor()!
  const activeDistributionIds = distributor.activeDistributionIds
  activeDistributionIds.push(distribution.id)
  distributor.activeDistributionIds = activeDistributionIds
  distributor.save()

  log.info('[MerkleDistributor] PeriodicDistributionAdded data={} token={} amount={}', [
    distribution.data.toHex(),
    distribution.token.toHex(),
    distribution.amount.toString(),
  ])
}

export function handleOneTimeDistributionAdded(event: OneTimeDistributionAdded): void {
  const network = loadNetwork()!
  const rewardsIpfsHash = parseIpfsHash(event.params.rewardsIpfsHash)
  const token = event.params.token
  let totalAmountToDistribute = event.params.amount
  const extraData = event.params.extraData
  const caller = event.params.caller

  if (!isTokenSupported(token)) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded Unsupported token={}', [token.toHexString()])
    return
  }

  const distType = getDistributionType(extraData)
  if (distType != DistributionType.VAULT) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded Only vault distributions are supported', [])
    return
  }

  const vault = loadVault(Address.fromBytes(extraData))
  if (vault === null) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded vault={} not found', [extraData.toHex()])
    return
  }

  if (rewardsIpfsHash != null) {
    const userRewards = fetchRewardsData(rewardsIpfsHash!)
    const isBoostRefund =
      token.equals(OS_TOKEN) && caller.equals(Address.fromHexString('0x2685C0e39EEAAd383fB71ec3F493991d532A87ae'))
    if (isBoostRefund && userRewards == null) {
      assert(false, '[MerkleDistributor] OneTimeDistributionAdded Failed to fetch boost refund rewards data')
    }
    if (userRewards != null) {
      distributeToVaultSelectedUsers(network, vault, token, totalAmountToDistribute, userRewards, isBoostRefund)
      log.info(
        '[MerkleDistributor] OneTimeDistributionAdded vault={} token={} amount={} selectedUsers=true isBoostRefund={}',
        [vault.id, token.toHexString(), totalAmountToDistribute.toString(), isBoostRefund ? 'true' : 'false'],
      )
    } else {
      log.error('[MerkleDistributor] OneTimeDistributionAdded rewardsIpfsHash={} not found', [rewardsIpfsHash!])
    }
  } else {
    distributeToVaultUsers(network, vault, token, totalAmountToDistribute)
    log.info('[MerkleDistributor] OneTimeDistributionAdded vault={} token={} amount={} selectedUsers=false', [
      vault.id,
      token.toHexString(),
      totalAmountToDistribute.toString(),
    ])
  }
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
      const amount = amounts[j]
      if (claimedAmount == null) {
        unclaimedAmounts.push(amount)
      } else if (claimedAmount.cumulativeClaimedAmount.gt(amount)) {
        log.error(
          '[MerkleDistributor] RewardsRootUpdated claimed amount is greater than total amount for user={} token={} delta={}',
          [user.toHex(), tokens[j].toHex(), claimedAmount.cumulativeClaimedAmount.minus(amount).toString()],
        )
        unclaimedAmounts.push(BigInt.zero())
      } else {
        unclaimedAmounts.push(amount.minus(claimedAmount.cumulativeClaimedAmount))
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
    const token = tokens[i]
    const claimedAmountId = `${token.toHex()}-${user.toHex()}`
    let claimedAmount = DistributorClaimedAmount.load(claimedAmountId)
    if (claimedAmount == null) {
      claimedAmount = new DistributorClaimedAmount(claimedAmountId)
      claimedAmount.cumulativeClaimedAmount = BigInt.zero()
    }
    claimedAmount.cumulativeClaimedAmount = cumulativeAmounts[i]
    claimedAmount.save()
    unclaimedAmounts[i] = BigInt.zero()

    const distributorReward = createOrLoadDistributorReward(token, user)
    if (claimedAmount.cumulativeClaimedAmount.gt(distributorReward.cumulativeAmount)) {
      log.error(
        '[MerkleDistributor] RewardsClaimed claimed amount is greater than total amount for user={} token={} delta={}',
        [
          user.toHex(),
          token.toHex(),
          claimedAmount.cumulativeClaimedAmount.minus(distributorReward.cumulativeAmount).toString(),
        ],
      )
      distributorReward.cumulativeAmount = claimedAmount.cumulativeClaimedAmount
      distributorReward.save()
    }
  }

  claim.unclaimedAmounts = unclaimedAmounts
  claim.save()

  createTransaction(event.transaction.hash.toHex())
  log.info('[MerkleDistributor] RewardsClaimed user={}', [user.toHex()])
}

export function handleDistributorUpdated(event: DistributorUpdated): void {
  const distributor = loadDistributor()!
  const activeDistributors = distributor.activeDistributors
  const index = activeDistributors.indexOf(event.params.distributor)
  if (index == -1 && event.params.isEnabled) {
    activeDistributors.push(event.params.distributor)
  }
  if (index != -1 && !event.params.isEnabled) {
    activeDistributors.splice(index, 1)
  }
  distributor.activeDistributors = activeDistributors
  distributor.save()
  log.info('[MerkleDistributor] DistributorUpdated distributor={} isEnabled={}', [
    event.params.distributor.toHex(),
    event.params.isEnabled ? 'true' : 'false',
  ])
}

export function syncDistributor(block: ethereum.Block): void {
  const distributor = loadDistributor()
  const network = loadNetwork()
  const exchangeRate = loadExchangeRate()

  if (!network || !distributor || !exchangeRate) {
    log.warning('[SyncDistributor] Network or Distributor or ExchangeRate not found', [])
    return
  }

  const newTimestamp = block.timestamp
  const distributorCheckpoint = createOrLoadCheckpoint(CheckpointType.DISTRIBUTOR)
  updatePeriodicDistributions(network, exchangeRate, distributor, newTimestamp)

  distributorCheckpoint.timestamp = newTimestamp
  distributorCheckpoint.save()
  log.info('[SyncDistributor] Distributions synced timestamp={}', [newTimestamp.toString()])
}
