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
  distributeToVaultSelectedUsers,
  distributeToVaultUsers,
  DistributionType,
  fetchRewardsData,
  getDistributionType,
  loadDistributor,
  loadDistributorClaim,
  redistributeMetaVaultsRewards,
  updateDistributions,
} from '../entities/merkleDistributor'
import { createTransaction } from '../entities/transaction'
import { convertTokenAmountToAssets, isTokenSupported, loadExchangeRate } from '../entities/exchangeRates'
import { loadVault } from '../entities/vault'
import { loadNetwork } from '../entities/network'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { loadOsToken } from '../entities/osToken'

const secondsInYear = '31536000'

export function handlePeriodicDistributionAdded(event: PeriodicDistributionAdded): void {
  const token = event.params.token
  const extraData = event.params.extraData

  const distType = getDistributionType(extraData)
  if (distType == DistributionType.UNKNOWN) {
    log.error('[MerkleDistributor] Unknown periodic distribution extraData={}', [extraData.toHex()])
    return
  }
  if (!isTokenSupported(token)) {
    log.error('[PeriodicDistribution] Unsupported token={}', [token.toHexString()])
    return
  }

  const startTimestamp = event.block.timestamp.plus(event.params.delayInSeconds)
  let endTimestamp: BigInt
  if (distType == DistributionType.LEVERAGE_STRATEGY) {
    // the actual end timestamp will be calculated during first distribution
    endTimestamp = startTimestamp.plus(BigInt.fromString(secondsInYear))
  } else {
    endTimestamp = startTimestamp.plus(event.params.durationInSeconds)
  }

  const distribution = new PeriodicDistribution(`${event.transaction.hash.toHex()}-${event.logIndex.toString()}`)
  distribution.hash = event.transaction.hash
  distribution.distributionType = convertDistributionTypeToString(distType)
  distribution.data = extraData
  distribution.token = token
  distribution.amount = event.params.amount
  distribution.startTimestamp = startTimestamp
  distribution.endTimestamp = endTimestamp
  distribution.apy = BigDecimal.zero()
  distribution.apys = []
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
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const token = event.params.token
  let totalAmountToDistribute = event.params.amount
  const extraData = event.params.extraData

  if (!isTokenSupported(token)) {
    log.error('[OneTimeDistribution] Unsupported token={}', [token.toHexString()])
    return
  }

  const distType = getDistributionType(extraData)
  if (distType != DistributionType.VAULT) {
    log.error('[OneTimeDistribution] Only vault distributions are supported', [])
    return
  }

  const userRewards = fetchRewardsData(rewardsIpfsHash)
  if (rewardsIpfsHash !== '' && userRewards === null) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded rewardsIpfsHash={} not found', [rewardsIpfsHash])
    return
  }

  // distribute to all vault users
  const network = loadNetwork()!
  const exchangeRate = loadExchangeRate()!
  const vault = loadVault(Address.fromBytes(extraData))
  if (vault === null) {
    log.error('[MerkleDistributor] OneTimeDistributionAdded vault={} not found', [extraData.toHex()])
    return
  }
  let selectedUsers = false
  if (userRewards !== null) {
    selectedUsers = true
    totalAmountToDistribute = distributeToVaultSelectedUsers(
      network,
      exchangeRate,
      vault,
      token,
      totalAmountToDistribute,
      userRewards,
    )
    if (totalAmountToDistribute.isZero()) {
      log.error('[MerkleDistributor] No users found for vault={} rewardsIpfsHash={}', [vault.id, rewardsIpfsHash])
      return
    }
    // do not update vault._periodExtraEarnedAssets here as the reward was distributed to selected users only
  } else {
    const principalAssets = distributeToVaultUsers(network, exchangeRate, vault, token, totalAmountToDistribute)
    if (principalAssets.isZero()) {
      log.error('[MerkleDistributor] No users found for vault={}', [vault.id])
      return
    }
    const distributedAssets = convertTokenAmountToAssets(exchangeRate, token, totalAmountToDistribute)
    vault._periodExtraEarnedAssets = vault._periodExtraEarnedAssets.plus(distributedAssets)
    vault.save()
  }
  // as meta-vaults are allocators in the vault, we need to redistribute rewards to their users
  redistributeMetaVaultsRewards(network, exchangeRate)
  log.info('[MerkleDistributor] OneTimeDistributionAdded vault={} token={} amount={} selectedUsers={}', [
    vault.id,
    token.toHexString(),
    totalAmountToDistribute.toString(),
    selectedUsers.toString(),
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
  const osToken = loadOsToken()

  if (!network || !osToken || !distributor || !exchangeRate) {
    log.warning('[SyncDistributor] OsToken or Network or Distributor or ExchangeRate not found', [])
    return
  }

  const newTimestamp = block.timestamp
  const distributorCheckpoint = createOrLoadCheckpoint(CheckpointType.DISTRIBUTOR)
  updateDistributions(network, exchangeRate, osToken, distributor, newTimestamp)

  distributorCheckpoint.timestamp = newTimestamp
  distributorCheckpoint.save()
  log.info('[SyncDistributor] Distributions synced timestamp={}', [newTimestamp.toString()])
}
