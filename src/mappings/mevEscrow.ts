import { MevReceived } from '../../generated/templates/MevEscrow/MevEscrow'
import { Vault } from '../../generated/schema'
import { createOrLoadDaySnapshot } from '../entities/daySnapshot'
import { BigInt } from '@graphprotocol/graph-ts'


export function handleMevReceived(event: MevReceived): void {
  const vaultId = event.address.toHex()
  const vault = Vault.load(vaultId) as Vault

  const reward = event.params.amount

  vault.executionReward = vault.executionReward.plus(reward)
  vault.totalAssets = vault.totalAssets.plus(reward)
  vault.save()

  const daySnapshot = createOrLoadDaySnapshot(event.block.timestamp, vaultId)

  // rewardPerAsset += reward * (maxFeePercent - vault.feePercent) / maxFeePercent / principalAssets
  const maxFeePercent = BigInt.fromI32(10000)
  const vaultFeePercent = BigInt.fromI32(vault.feePercent)
  const percent = maxFeePercent.minus(vaultFeePercent)
  const rewardPerAsset = reward.times(percent).div(maxFeePercent).div(daySnapshot.principalAssets)

  daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)
  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(reward)
  daySnapshot.save()
}
