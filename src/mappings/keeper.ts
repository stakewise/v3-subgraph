import {BigInt, ipfs, JSONValue, log, Value} from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { RewardsRootUpdated } from '../../generated/Keeper/Keeper'
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
    const rewardPerAsset = getRewardPerAsset(reward, snapshot.principalAssets, vault.feePercent)
    snapshot.totalAssets = snapshot.totalAssets.plus(reward)
    snapshot.rewardPerAsset = snapshot.rewardPerAsset.plus(rewardPerAsset)
    snapshot.save()

    rewardLeft = rewardLeft.minus(reward)
    snapshotStart = snapshotEnd
    snapshotEnd = snapshotStart.plus(DAY).div(DAY).times(DAY)
  }

  if (rewardLeft.notEqual(BigInt.zero())) {
    const snapshot = createOrLoadDaySnapshot(toTimestamp, vault)
    const rewardPerAsset = getRewardPerAsset(rewardLeft, snapshot.principalAssets, vault.feePercent)
    snapshot.totalAssets = snapshot.totalAssets.plus(rewardLeft)
    snapshot.rewardPerAsset = snapshot.rewardPerAsset.plus(rewardPerAsset)
    snapshot.save()
  }
}

export function updateRewardsRoot(value: JSONValue, callbackDataValue: Value): void {
  const callbackData = callbackDataValue.toArray()
  const rewardsRoot = callbackData[0].toBytes()
  const updateTimestamp = callbackData[1].toBigInt()
  const vaultRewards = value.toArray()
  for (let i = 0; i < vaultRewards.length; i++) {
    const vaultReward = vaultRewards[i].toObject();
    const vaultId = vaultReward.mustGet('vault').toString().toLowerCase()
    const vault = Vault.load(vaultId)
    if (!vault) {
      continue
    }

    const reward = vaultReward.mustGet('reward').toBigInt()
    const proof = vaultReward.mustGet('proof').toArray()
    const periodReward = vault.proofReward ? reward.minus(vault.proofReward as BigInt) : reward
    const lastUpdateTimestamp = vault.rewardsRootTimestamp ? (vault.rewardsRootTimestamp as BigInt) : updateTimestamp
    updateDaySnapshots(vault, lastUpdateTimestamp, updateTimestamp, periodReward)

    vault.rewardsRoot = rewardsRoot
    vault.proofReward = reward
    vault.rewardsRootTimestamp = updateTimestamp
    vault.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    vault.totalAssets = vault.totalAssets.plus(periodReward)
    vault.consensusReward = vault.consensusReward.plus(periodReward)
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
  ])

  ipfs.mapJSON(rewardsIpfsHash, 'updateRewardsRoot', callbackData)
  log.info(
    '[Keeper] RewardsRootUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}',
    [
        rewardsRoot.toHex(),
        rewardsIpfsHash,
        updateTimestamp.toString()
    ]
  )
}
