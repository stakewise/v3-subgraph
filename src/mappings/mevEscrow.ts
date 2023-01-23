import { MevEscrow, Vault } from '../../generated/schema'
import { MevReceived } from '../../generated/templates/MevEscrow/MevEscrow'
import { createOrLoadDaySnapshot, getRewardPerAsset } from '../entities/daySnapshot'


export function handleMevReceived(event: MevReceived): void {
  const mevEscrowAddress = event.address.toHex()

  const mevEscrow = MevEscrow.load(mevEscrowAddress)

  if (mevEscrow) {
    const vaultId = mevEscrow.vault
    const vault = Vault.load(vaultId) as Vault

    const reward = event.params.amount

    vault.executionReward = vault.executionReward.plus(reward)
    vault.totalAssets = vault.totalAssets.plus(reward)
    vault.save()

    const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vaultId)
    const rewardPerAsset = getRewardPerAsset(reward, vault.feePercent, daySnapshot.principalAssets)

    daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)
    daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
    daySnapshot.save()
  }
}
