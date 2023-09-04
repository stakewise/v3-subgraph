import { log, BigInt } from '@graphprotocol/graph-ts'
import { RewardSplitterCreated } from '../../generated/RewardSplitterFactory/RewardSplitterFactory'
import { RewardSplitter as RewardSplitterTemplate } from '../../generated/templates'
import { SharesIncreased, SharesDecreased } from '../../generated/templates/RewardSplitter/RewardSplitter'
import { RewardSplitter } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import { createOrLoadRewardSplitterShareHolder } from '../entities/rewardSplitter'

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

  const shareHolder = createOrLoadRewardSplitterShareHolder(account, rewardSplitterAddress)
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

  const shareHolder = createOrLoadRewardSplitterShareHolder(account, rewardSplitterAddress)
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
