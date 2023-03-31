import { OwnMevEscrow, Vault } from '../../generated/schema'
import { MevReceived, Harvested } from '../../generated/templates/OwnMevEscrow/OwnMevEscrow'
import { Multicall } from '../../generated/templates/Vault/Multicall'
import { createOrLoadDaySnapshot, getRewardPerAsset, updateAvgRewardPerAsset } from '../entities/daySnapshot'
import { Address, ethereum, log } from "@graphprotocol/graph-ts";


export function handleMevReceived(event: MevReceived): void {
  const mevEscrow = OwnMevEscrow.load(event.address.toHex()) as OwnMevEscrow
  const vault = Vault.load(mevEscrow.vault) as Vault

  const block = event.block
  const assets = event.params.assets

  const daySnapshot = createOrLoadDaySnapshot(block.timestamp, vault)
  const rewardPerAsset = getRewardPerAsset(assets, vault.principalAssets, vault.feePercent)
  daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)
  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(assets)
  daySnapshot.save()

  mevEscrow.balance = mevEscrow.balance.plus(assets)
  mevEscrow.save()

  vault.totalAssets = vault.totalAssets.plus(assets)
  updateAvgRewardPerAsset(block.timestamp, vault)
  vault.save()

  log.info(
    '[OwnMevEscrow] MevReceived vault={} assets={}',
    [
      vault.id,
      assets.toString(),
    ]
  )
}

export function handleHarvested(event: Harvested): void {
  const assets = event.params.assets

  const mevEscrow = OwnMevEscrow.load(event.address.toHex()) as OwnMevEscrow
  const vaultId = mevEscrow.vault
  const vault = Vault.load(vaultId) as Vault

  mevEscrow.balance = mevEscrow.balance.minus(assets)
  mevEscrow.save()

  vault.principalAssets = vault.principalAssets.plus(assets)
  vault.save()

  log.info(
    '[OwnMevEscrow] Harvested vault={} assetsDelta={}',
    [
      vaultId,
      assets.toString(),
    ]
  )
}

export function handleBlock(block: ethereum.Block): void {
  const mevEscrowAddress = block.author.toHex()
  const mevEscrow = OwnMevEscrow.load(mevEscrowAddress)
  if (!mevEscrow) {
    return
  }

  // TODO get address from env or config
  const multicallContract = Multicall.bind(Address.fromString('0x77dCa2C955b15e9dE4dbBCf1246B4B85b651e50e'))
  const mevEscrowBalance = multicallContract.getEthBalance(block.author)

  const vaultAddress = mevEscrow.vault
  const vault = Vault.load(vaultAddress) as Vault
  const reward = mevEscrowBalance.minus(mevEscrow.balance)

  mevEscrow.balance = mevEscrowBalance
  mevEscrow.save()

  const daySnapshot = createOrLoadDaySnapshot(block.timestamp, vault)
  const rewardPerAsset = getRewardPerAsset(reward, vault.principalAssets, vault.feePercent)

  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
  daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)
  daySnapshot.save()

  vault.totalAssets = vault.totalAssets.plus(reward)
  updateAvgRewardPerAsset(block.timestamp, vault)
  vault.save()

  log.info(
    '[Block] author={} escrow={} reward={}',
    [
      mevEscrowAddress.toString(),
      block.number.toString(),
      reward.toString(),
    ]
  )
}
