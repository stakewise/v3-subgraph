import { BigInt, ipfs, json, JSONValue, JSONValueKind } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { RewardsRootUpdated } from '../../generated/templates/Keeper/Keeper'
import { createOrLoadDaySnapshot, getRewardPerAsset } from '../entities/daySnapshot'


export function handleRewardsRootUpdated(event: RewardsRootUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp

  const data = ipfs.cat(rewardsIpfsHash)

  if (data) {
    const parsedJson = json.try_fromBytes(data)

    if (parsedJson.isOk && !parsedJson.isError) {
      const isArray = parsedJson.value.kind === JSONValueKind.ARRAY

      if (isArray) {
        const json = parsedJson.value.toArray()

        for (let jsonIndex = 0; jsonIndex < json.length; jsonIndex++) {
          const jsonValue = json[jsonIndex] as JSONValue
          const isObject = jsonValue.kind === JSONValueKind.OBJECT

          if (isObject) {
            const value = jsonValue.toObject()

            const vaultId = value.get('vault')
            const reward = value.get('reward')
            const proof = value.get('proof')

            if (vaultId && reward && proof) {
              const vault = Vault.load(vaultId.toString())

              if (vault) {
                const rewardBigInt = BigInt.fromString(reward.toString())
                const lastUpdateTimestamp = vault.rewardsRootTimestamp
                const day = BigInt.fromI32(24 * 60 * 60 * 1000)
                const daysBetween = lastUpdateTimestamp
                  ? updateTimestamp.minus(lastUpdateTimestamp).div(day).toI32()
                  : 1

                for (let i = 0; i < daysBetween; i++) {
                  const diff = day.times(BigInt.fromI32(i))
                  const timestamp = updateTimestamp.plus(diff)
                  const daySnapshot = createOrLoadDaySnapshot(timestamp, vaultId.toString())
                  const rewardPerAsset = getRewardPerAsset(rewardBigInt, vault.feePercent, daySnapshot.principalAssets)

                  daySnapshot.totalAssets = daySnapshot.totalAssets.plus(rewardBigInt)
                  daySnapshot.rewardPerAsset = daySnapshot.rewardPerAsset.plus(rewardPerAsset)

                  daySnapshot.save()
                }

                vault.rewardsRoot = rewardsRoot
                vault.proofReward = rewardBigInt
                vault.consensusReward = rewardBigInt
                vault.rewardsRootTimestamp = updateTimestamp
                vault.proof = proof.toArray().map<string>((proofValue: JSONValue) => proofValue.toString())
                vault.totalAssets = vault.totalAssets.plus(rewardBigInt)

                vault.save()
              }
            }
          }
        }
      }
    }
  }
}
