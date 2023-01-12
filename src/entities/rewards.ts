import { BigInt, JSONValue, JSONValueKind } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'


export function updateRewards(rewards: JSONValue): void {
  if (rewards.kind !== JSONValueKind.OBJECT) return
  const json = rewards.toArray()

  json.forEach((jsonValue: JSONValue) => {
    const value = jsonValue.toObject()

    const vaultId = value.get('vault')
    const reward = value.get('reward')
    const proof = value.get('proof')

    if (vaultId && reward && proof) {
      const vault = Vault.load(vaultId.toString())

      if (vault) {
        const rewardNumber = BigInt.fromString(reward.toString())

        vault.consensusReward = vault.consensusReward.plus(rewardNumber).minus(vault.proofReward as BigInt)
        vault.proofReward = rewardNumber
        vault.proof = proof.toArray().map<string>((proofValue: JSONValue) => proofValue.toString())
        // vault.consensusReward = vault.consensusReward.plus(rewardNumber)
        vault.totalAssets = vault.totalAssets.plus(rewardNumber)
      }
    }
  })
}
