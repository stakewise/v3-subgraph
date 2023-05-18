import { Address, ethereum, log } from '@graphprotocol/graph-ts'
import { Multicall } from '../../generated/templates/Vault/Multicall'
import { MevReceived } from '../../generated/templates/MevEscrow/MevEscrow'
import { MevEscrow, Vault } from '../../generated/schema'
import { createOrLoadDaySnapshot, getRewardPerAsset, updateAvgRewardPerAsset } from '../entities/daySnapshot'
import { multicallAddress } from '../helpers/constants'


export function handleMevReceived(event: MevReceived): void {
  const mevEscrowAddress = event.address.toHex()

  const mevEscrow = MevEscrow.load(mevEscrowAddress)

  if (mevEscrow) {
    const vaultId = mevEscrow.vault
    const vault = Vault.load(vaultId) as Vault

    const block = event.block
    const reward = event.params.amount

    const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vault)
    const rewardPerAsset = getRewardPerAsset(reward, daySnapshot.principalAssets, vault.feePercent)
    daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)
    daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
    daySnapshot.save()

    vault.executionReward = vault.executionReward.plus(reward)
    vault.totalAssets = vault.totalAssets.plus(reward)
    updateAvgRewardPerAsset(block.timestamp, vault)
    vault.save()
  }
}

export function handleBlock(block: ethereum.Block): void {
  const mevEscrowAddress = block.author.toHex()
  const mevEscrow = MevEscrow.load(mevEscrowAddress)

  if (mevEscrow) {
    // TODO get address from env or config
    const multicallContract = Multicall.bind(Address.fromString(multicallAddress))
    const mevEscrowBalance = multicallContract.getEthBalance(block.author)

    const vaultAddress = mevEscrow.vault
    const vault = Vault.load(vaultAddress) as Vault
    const reward = mevEscrowBalance.minus(vault.executionReward)

    const daySnapshot = createOrLoadDaySnapshot(block.timestamp, vault)
    const rewardPerAsset = getRewardPerAsset(reward, daySnapshot.principalAssets, vault.feePercent)

    daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
    daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)

    daySnapshot.save()

    vault.executionReward = vault.executionReward.plus(reward)
    vault.totalAssets = vault.totalAssets.plus(reward)
    updateAvgRewardPerAsset(block.timestamp, vault)

    vault.save()

    log.info(
      '[Vault] Block timestamp={}',
      [
        block.timestamp.toString(),
      ]
    )
  }
}
