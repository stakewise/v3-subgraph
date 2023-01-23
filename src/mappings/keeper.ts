import { BigInt, ipfs, JSONValue, JSONValueKind, Value } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { RewardsRootUpdated } from '../../generated/templates/Keeper/Keeper'
import { createOrLoadDaySnapshot, getRewardPerAsset } from '../entities/daySnapshot'
import { DAY } from '../helpers/constants'


function updateRewardsRoot(rewardsRoot: JSONValue, callbackDataValue: Value): void {
  if (rewardsRoot.kind === JSONValueKind.OBJECT) {
    const json = rewardsRoot.toObject()

    const vaultId = json.get('vault')
    const reward = json.get('reward')
    const proof = json.get('proof')

    if (vaultId && reward && proof) {
      const vault = Vault.load(vaultId.toString())
      const callbackData = callbackDataValue.toArray()
      const rewardsRoot = callbackData[0].toBytes()
      const updateTimestamp = callbackData[1].toBigInt()

      if (vault) {
        const rewardBigInt = BigInt.fromString(reward.toString())
        const periodReward = vault.proofReward
          ? rewardBigInt.minus(vault.proofReward as BigInt)
          : rewardBigInt

        const lastUpdateTimestamp = vault.rewardsRootTimestamp
        const daysBetween = lastUpdateTimestamp
          ? updateTimestamp.minus(lastUpdateTimestamp).div(DAY).toI32()
          : 1

        let rewardLeft = rewardBigInt

        for (let i = 0; i < daysBetween; i++) {
          const isLastDay = i + 1 === daysBetween
          const isFirstDay = i === 0

          let dayReward = rewardBigInt.div(daysBetween)

          if (isLastDay) {
            dayReward = rewardLeft
          }
          else if (isFirstDay && lastUpdateTimestamp) {
            const endOfFirstDay = lastUpdateTimestamp.plus(DAY).div(DAY).times(DAY).minus(BigInt.fromI32(1))
            const diff = endOfFirstDay.minus(lastUpdateTimestamp)

            dayReward = dayReward.div(DAY).times(diff)
          }

          rewardLeft = rewardLeft.minus(dayReward)

          const diff = DAY.times(BigInt.fromI32(i))
          const timestamp = updateTimestamp.plus(diff)
          const daySnapshot = createOrLoadDaySnapshot(timestamp, vaultId.toString())
          const rewardPerAsset = getRewardPerAsset(dayReward, vault.feePercent, daySnapshot.principalAssets)

          daySnapshot.totalAssets = daySnapshot.totalAssets.plus(dayReward)
          daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)

          daySnapshot.save()
        }

        vault.rewardsRoot = rewardsRoot
        vault.proofReward = rewardBigInt
        vault.rewardsRootTimestamp = updateTimestamp
        vault.proof = proof.toArray().map<string>((proofValue: JSONValue) => proofValue.toString())
        vault.totalAssets = vault.totalAssets.plus(periodReward)
        vault.consensusReward = vault.consensusReward.plus(periodReward)

        vault.save()
      }
    }
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
}
