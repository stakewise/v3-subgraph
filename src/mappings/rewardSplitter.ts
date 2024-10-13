import { BigInt, log } from '@graphprotocol/graph-ts'
import { RewardSplitter as RewardSplitterTemplate } from '../../generated/templates'
import {
  RewardsWithdrawn,
  SharesDecreased,
  SharesIncreased,
} from '../../generated/templates/RewardSplitter/RewardSplitter'
import { RewardSplitterCreated } from '../../generated/templates/RewardSplitterFactory/RewardSplitterFactory'
import { RewardSplitter, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import { createOrLoadRewardSplitterShareHolder, snapshotRewardSplitterShareHolder } from '../entities/rewardSplitter'
import { convertSharesToAssets } from '../entities/vaults'

// Event emitted on RewardSplitter contract creation
export function handleRewardSplitterCreated(event: RewardSplitterCreated): void {
  const params = event.params
  const owner = params.owner
  const txHash = event.transaction.hash.toHex()
  const vault = params.vault.toHex()
  const rewardSplitterAddress = params.rewardSplitter.toHex()

  const rewardSplitter = new RewardSplitter(rewardSplitterAddress)
  rewardSplitter.totalShares = BigInt.zero()
  rewardSplitter.owner = owner
  rewardSplitter.vault = vault
  rewardSplitter.lastSnapshotTimestamp = event.block.timestamp
  rewardSplitter.save()

  createTransaction(txHash)

  RewardSplitterTemplate.create(params.rewardSplitter)

  log.info('[RewardSplitterFactory] RewardSplitterCreated address={} vault={} owner={}', [
    rewardSplitterAddress,
    vault,
    owner.toHex(),
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

  const shareHolder = createOrLoadRewardSplitterShareHolder(account, rewardSplitterAddress, rewardSplitter.vault)
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

  const rewardSplitter = RewardSplitter.load(rewardSplitterAddressHex) as RewardSplitter
  const vault = Vault.load(rewardSplitter.vault) as Vault

  const shareHolder = createOrLoadRewardSplitterShareHolder(account, rewardSplitterAddress, rewardSplitter.vault)
  shareHolder.earnedVaultShares = shareHolder.earnedVaultShares.minus(withdrawnVaultShares)
  if (shareHolder.earnedVaultShares.lt(BigInt.zero())) {
    shareHolder.earnedVaultShares = BigInt.zero()
  }
  shareHolder.earnedVaultAssets = convertSharesToAssets(vault, shareHolder.earnedVaultShares)
  shareHolder.save()
  snapshotRewardSplitterShareHolder(shareHolder, BigInt.zero(), event.block.timestamp)

  const txHash = event.transaction.hash.toHex()
  createTransaction(txHash)

  log.info('[RewardSplitter] RewardsWithdrawn rewardSplitter={} account={} withdrawnVaultShares={}', [
    rewardSplitterAddressHex,
    account.toHex(),
    withdrawnVaultShares.toString(),
  ])
}
