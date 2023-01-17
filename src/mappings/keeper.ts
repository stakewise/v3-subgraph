import { BigInt, ipfs, json, JSONValue, JSONValueKind } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { RewardsRootUpdated } from '../../generated/templates/Keeper/Keeper'


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

        json.forEach((jsonValue: JSONValue) => {
          const isObject = jsonValue.kind === JSONValueKind.OBJECT

          if (isObject) {
            const value = jsonValue.toObject()

            const vaultId = value.get('vault')
            const reward = value.get('reward')
            const proof = value.get('proof')

            if (vaultId && reward && proof) {
              const vault = Vault.load(vaultId.toString())

              if (vault) {
                const rewardNumber = BigInt.fromString(reward.toString())
                // todo add split logic between last update and the current one
                const lastUpdateTimestamp = vault.rewardsRootTimestamp

                vault.rewardsRoot = rewardsRoot
                vault.proofReward = rewardNumber
                vault.rewardsRootTimestamp = updateTimestamp
                vault.consensusReward = vault.consensusReward.plus(rewardNumber).minus(vault.proofReward as BigInt)
                vault.proof = proof.toArray().map<string>((proofValue: JSONValue) => proofValue.toString())
                // vault.consensusReward = vault.consensusReward.plus(rewardNumber) todo do we need this?
                vault.totalAssets = vault.totalAssets.plus(rewardNumber)

                vault.save()
              }
            }
          }
        })
      }
      // updateRewards(parsedJson.value)
    }
  }
}
