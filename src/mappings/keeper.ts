import {BigInt, ipfs, JSONValue, log, Value} from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { RewardsRootUpdated, Harvested } from '../../generated/Keeper/Keeper'
import {createOrLoadDaySnapshot, getRewardPerAsset, updateAvgRewardPerAsset} from '../entities/daySnapshot'
import { DAY } from '../helpers/constants'


function updateDaySnapshots(vault: Vault, fromTimestamp: BigInt, toTimestamp: BigInt, totalReward: BigInt): void {
  const totalDuration = toTimestamp.minus(fromTimestamp)
  let rewardLeft = totalReward
  let snapshotStart = fromTimestamp
  let snapshotEnd = snapshotStart.plus(DAY).div(DAY).times(DAY)

  while (snapshotEnd < toTimestamp) {
    const reward = totalReward.times(snapshotEnd.minus(snapshotStart)).div(totalDuration)
    const snapshot = createOrLoadDaySnapshot(snapshotStart, vault)
    const rewardPerAsset = getRewardPerAsset(reward, vault.principalAssets, vault.feePercent)
    snapshot.totalAssets = snapshot.totalAssets.plus(reward)
    snapshot.rewardPerAsset = snapshot.rewardPerAsset.plus(rewardPerAsset)
    snapshot.save()

    rewardLeft = rewardLeft.minus(reward)
    snapshotStart = snapshotEnd
    snapshotEnd = snapshotStart.plus(DAY).div(DAY).times(DAY)
  }

  if (rewardLeft.notEqual(BigInt.zero())) {
    const snapshot = createOrLoadDaySnapshot(toTimestamp, vault)
    const rewardPerAsset = getRewardPerAsset(rewardLeft, vault.principalAssets, vault.feePercent)
    snapshot.totalAssets = snapshot.totalAssets.plus(rewardLeft)
    snapshot.rewardPerAsset = snapshot.rewardPerAsset.plus(rewardPerAsset)
    snapshot.save()
  }
}

export function updateRewards(value: JSONValue, callbackDataValue: Value): void {
  const callbackData = callbackDataValue.toArray()
  const rewardsRoot = callbackData[0].toBytes()
  const updateTimestamp = callbackData[1].toBigInt()
  const rewardsIpfsHash = callbackData[2].toString()
  const vaultRewards = value.toArray()
  for (let i = 0; i < vaultRewards.length; i++) {
    const vaultReward = vaultRewards[i].toObject();
    const vaultId = vaultReward.mustGet('vault').toString().toLowerCase()
    const vault = Vault.load(vaultId)
    if (!vault) {
      continue
    }

    const consensusReward = vaultReward.mustGet('consensusReward').toBigInt()
    const lockedMevReward = vaultReward.isSet('lockedMevReward') ? vaultReward.mustGet('lockedMevReward').toBigInt() : BigInt.zero()
    const unlockedMevReward = vaultReward.isSet('unlockedMevReward') ? vaultReward.mustGet('unlockedMevReward').toBigInt() : BigInt.zero()
    const proof = vaultReward.mustGet('proof').toArray()
    const proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
    const periodReward = vault.proofReward ? proofReward.minus(vault.proofReward as BigInt) : proofReward
    const lastUpdateTimestamp = vault.rewardsRootTimestamp ? (vault.rewardsRootTimestamp as BigInt) : updateTimestamp
    updateDaySnapshots(vault, lastUpdateTimestamp, updateTimestamp, periodReward)

    vault.totalAssets = vault.totalAssets.plus(periodReward)
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = unlockedMevReward
    vault.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    vault.rewardsRootTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    updateAvgRewardPerAsset(updateTimestamp, vault)
    vault.save()
  }
}

export function handleRewardsRootUpdated(event: RewardsRootUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp

  const callbackData = Value.fromArray([
    Value.fromBytes(rewardsRoot),
    Value.fromBigInt(updateTimestamp),
    Value.fromString(rewardsIpfsHash)
  ])

  ipfs.mapJSON(rewardsIpfsHash, 'updateRewards', callbackData)
  log.info(
    '[Keeper] RewardsRootUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}',
    [
        rewardsRoot.toHex(),
        rewardsIpfsHash,
        updateTimestamp.toString()
    ]
  )
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  const totalAssetsDelta = event.params.totalAssetsDelta
  const vaultAddress = event.params.vault.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  vault.save()

  log.info(
    '[Keeper] Harvested vault={} assetsDelta={}',
    [
      vaultAddress,
      totalAssetsDelta.toString(),
    ]
  )
}
