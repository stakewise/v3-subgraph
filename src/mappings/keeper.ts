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
    let lockedMevReward = vaultReward.isSet('locked_mev_reward')
      ? vaultReward.mustGet('locked_mev_reward').toBigInt()
      : BigInt.zero()
    let unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const proof = vaultReward.mustGet('proof').toArray()

    const newTotalReward = consensusReward.plus(unlockedMevReward).plus(lockedMevReward)
    const periodReward = vault.totalReward ? newTotalReward.minus(vault.totalReward as BigInt) : newTotalReward
    const lastUpdateTimestamp = vault.rewardsTimestamp ? (vault.rewardsTimestamp as BigInt) : updateTimestamp

    if (vault.mevEscrow !== null) {
      unlockedMevReward = BigInt.zero()
      lockedMevReward = BigInt.zero()
    }
    updateDaySnapshots(vault, lastUpdateTimestamp, updateTimestamp, periodReward)

    vault.totalReward = newTotalReward
    vault.totalAssets = vault.totalAssets.plus(periodReward)
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
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
  if (rewardsIpfsHash == 'bafkreigsvnhlb5mkuvosuzg4bkmtbhh4cxdlhqs54xvrn35zxnb2uvvpei') {
    log.warning('[Keeper] RewardsUpdated rewardsIpfsHash={} is invalid', [rewardsIpfsHash])
    return
  }

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
