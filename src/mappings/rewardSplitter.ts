import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import { RewardSplitter as RewardSplitterTemplate } from '../../generated/templates'
import {
  ClaimOnBehalfUpdated,
  RewardsWithdrawn,
  SharesDecreased,
  SharesIncreased,
  OwnershipTransferred,
} from '../../generated/templates/RewardSplitter/RewardSplitter'
import { RewardSplitterCreated } from '../../generated/templates/RewardSplitterFactory/RewardSplitterFactory'
import { RewardSplitter } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadRewardSplitterShareHolder,
  getRewardSplitterVersion,
  loadRewardSplitterShareHolder,
} from '../entities/rewardSplitter'
import { convertSharesToAssets, loadVault } from '../entities/vault'

// Event emitted on RewardSplitter contract creation
export function handleRewardSplitterCreated(event: RewardSplitterCreated): void {
  const params = event.params
  const owner = params.owner
  const txHash = event.transaction.hash.toHex()
  const vaultAddressHex = params.vault.toHex()
  const rewardSplitterAddress = params.rewardSplitter.toHex()
  const factoryAddress = event.address

  const version = getRewardSplitterVersion(factoryAddress)
  if (version === null) {
    log.error('[RewardSplitterFactory] Unknown factory address={}', [factoryAddress.toHex()])
    return
  }

  const rewardSplitter = new RewardSplitter(rewardSplitterAddress)
  rewardSplitter.version = version
  rewardSplitter.isClaimOnBehalfEnabled = false
  rewardSplitter.totalShares = BigInt.zero()
  rewardSplitter.owner = owner
  rewardSplitter.vault = vaultAddressHex

  if (version >= BigInt.fromI32(3)) {
    const vault = loadVault(Address.fromString(vaultAddressHex))
    if (vault == null) {
      log.error('[RewardSplitterFactory] Vault not found address={}', [vaultAddressHex])
      return
    }
    rewardSplitter.owner = vault.admin
  }
  rewardSplitter.save()

  createTransaction(txHash)

  RewardSplitterTemplate.create(params.rewardSplitter)

  log.info('[RewardSplitterFactory] RewardSplitterCreated address={} vault={} owner={}', [
    rewardSplitterAddress,
    vaultAddressHex,
    owner.toHex(),
  ])
}

// Event emitted on RewardSplitter claim on behalf update
export function handleClaimOnBehalfUpdated(event: ClaimOnBehalfUpdated): void {
  const params = event.params
  const rewardSplitterAddress = event.address
  const rewardSplitterAddressHex = rewardSplitterAddress.toHex()

  const rewardSplitter = RewardSplitter.load(rewardSplitterAddressHex) as RewardSplitter
  rewardSplitter.isClaimOnBehalfEnabled = params.enabled
  rewardSplitter.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[RewardSplitter] ClaimOnBehalfUpdated rewardSplitter={} enabled={}', [
    rewardSplitterAddressHex,
    params.enabled ? 'true' : 'false',
  ])
}

// Event emitted on RewardSplitter shares increase for the account
export function handleSharesIncreased(event: SharesIncreased): void {
  const params = event.params
  const account = params.account
  const shares = params.amount
  const rewardSplitterAddress = event.address
  const rewardSplitterAddressHex = rewardSplitterAddress.toHex()

  const rewardSplitter = RewardSplitter.load(rewardSplitterAddressHex) as RewardSplitter
  rewardSplitter.totalShares = rewardSplitter.totalShares.plus(shares)
  rewardSplitter.save()

  const shareHolder = createOrLoadRewardSplitterShareHolder(account, rewardSplitterAddress, rewardSplitter.vault)
  shareHolder.shares = shareHolder.shares.plus(shares)
  shareHolder.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[RewardSplitter] SharesIncreased rewardSplitter={} account={} shares={}', [
    rewardSplitterAddressHex,
    account.toHex(),
    shares.toString(),
  ])
}

// Event emitted on RewardSplitter shares decrease for the account
export function handleSharesDecreased(event: SharesDecreased): void {
  const params = event.params
  const account = params.account
  const shares = params.amount
  const rewardSplitterAddress = event.address
  const rewardSplitterAddressHex = rewardSplitterAddress.toHex()

  const rewardSplitter = RewardSplitter.load(rewardSplitterAddressHex) as RewardSplitter
  rewardSplitter.totalShares = rewardSplitter.totalShares.minus(shares)
  rewardSplitter.save()

  const shareHolder = loadRewardSplitterShareHolder(account, rewardSplitterAddress)!
  shareHolder.shares = shareHolder.shares.minus(shares)
  shareHolder.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[RewardSplitter] SharesDecreased rewardSplitter={} account={} shares={}', [
    rewardSplitterAddressHex,
    account.toHex(),
    shares.toString(),
  ])
}

// Event emitted on RewardSplitter rewards withdrawal
export function handleRewardsWithdrawn(event: RewardsWithdrawn): void {
  const params = event.params
  const account = params.account
  const withdrawnVaultShares = params.amount
  const rewardSplitterAddress = event.address
  const rewardSplitterAddressHex = rewardSplitterAddress.toHex()

  const rewardSplitter = RewardSplitter.load(rewardSplitterAddressHex)!
  const vault = loadVault(Address.fromString(rewardSplitter.vault))!

  const shareHolder = loadRewardSplitterShareHolder(account, rewardSplitterAddress)!
  shareHolder.earnedVaultShares = shareHolder.earnedVaultShares.minus(withdrawnVaultShares)
  if (shareHolder.earnedVaultShares.lt(BigInt.zero())) {
    shareHolder.earnedVaultShares = BigInt.zero()
  }
  shareHolder.earnedVaultAssets = convertSharesToAssets(vault, shareHolder.earnedVaultShares)
  shareHolder.save()

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[RewardSplitter] RewardsWithdrawn rewardSplitter={} account={} withdrawnVaultShares={}', [
    rewardSplitterAddressHex,
    account.toHex(),
    withdrawnVaultShares.toString(),
  ])
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  const rewardSplitter = RewardSplitter.load(event.address.toHex())!
  rewardSplitter.owner = event.params.newOwner
  rewardSplitter.save()

  log.info('[RewardSplitter] OwnershipTransferred rewardSplitter={} newOwner={}', [
    event.address.toHex(),
    event.params.newOwner.toHex(),
  ])
}
