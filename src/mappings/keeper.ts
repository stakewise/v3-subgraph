import { BigInt, ipfs, JSONValue, log, Value } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested, RewardsUpdated } from '../../generated/Keeper/Keeper'
import { updateAvgRewardPerAsset, updateDaySnapshots } from '../entities/daySnapshot'

export function updateRewards(value: JSONValue, callbackDataValue: Value): void {
  const callbackData = callbackDataValue.toArray()
  const rewardsRoot = callbackData[0].toBytes()
  const updateTimestamp = callbackData[1].toBigInt()
  const rewardsIpfsHash = callbackData[2].toString()
  const vaultRewards = value.toObject().mustGet('vaults').toArray()
  for (let i = 0; i < vaultRewards.length; i++) {
    const vaultReward = vaultRewards[i].toObject()
    const vaultId = vaultReward.mustGet('vault').toString().toLowerCase()
    const vault = Vault.load(vaultId)
    if (!vault) {
      log.warning('[Keeper] RewardsUpdated vault={} not found', [vaultId])
      continue
    }

    const consensusReward = vaultReward.mustGet('consensus_reward').toBigInt()
    const lockedMevReward = vaultReward.isSet('locked_mev_reward')
      ? vaultReward.mustGet('locked_mev_reward').toBigInt()
      : BigInt.zero()
    const unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const proof = vaultReward.mustGet('proof').toArray()
    const proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
    const periodReward = vault.proofReward ? proofReward.minus(vault.proofReward as BigInt) : proofReward
    const lastUpdateTimestamp = vault.rewardsTimestamp ? (vault.rewardsTimestamp as BigInt) : updateTimestamp
    updateDaySnapshots(vault, lastUpdateTimestamp, updateTimestamp, periodReward)

    vault.totalAssets = vault.totalAssets.plus(periodReward)
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = unlockedMevReward
    vault.lockedMevReward = lockedMevReward
    vault.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    updateAvgRewardPerAsset(updateTimestamp, vault)
    vault.save()
  }
}

export function handleRewardsUpdated(event: RewardsUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp

  const callbackData = Value.fromArray([
    Value.fromBytes(rewardsRoot),
    Value.fromBigInt(updateTimestamp),
    Value.fromString(rewardsIpfsHash),
  ])

  ipfs.mapJSON(rewardsIpfsHash, 'updateRewards', callbackData)
  log.info('[Keeper] RewardsUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
    updateTimestamp.toString(),
  ])
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  const totalAssetsDelta = event.params.totalAssetsDelta
  const vaultAddress = event.params.vault.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  vault.save()

  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
}
