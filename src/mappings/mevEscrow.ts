import { MevReceived } from '../../generated/templates/MevEscrow/MevEscrow'
import { Vault } from '../../generated/schema'


export function handleMevReceived(event: MevReceived): void {
  const vaultId = event.address.toHex()
  const vault = Vault.load(vaultId) as Vault

  const reward = event.params.amount

  vault.executionReward = vault.executionReward.plus(reward)
  vault.totalAssets = vault.totalAssets.plus(reward)

  vault.save()
  // daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
  // daySnapshot.rewardPerAsset += reward * (maxFeePercent - vault.feePercent) / maxFeePercent / principalAssets
  // const feePercent = BigNumber.fromI32(10000)
  // const percent = feePercent.minus(vault.feePercent)
  // daySnapshot.rewardPerAsset = reward.times(percent).div(feePercent).div(principalAssets)
  // daySnapshot.save()
}
