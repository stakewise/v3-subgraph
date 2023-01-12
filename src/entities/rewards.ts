import { BigInt, JSONValue, JSONValueKind } from '@graphprotocol/graph-ts'

import {Vault} from '../../generated/schema'


export function updateRewards(rewards: JSONValue): void {
  if (rewards.kind !== JSONValueKind.OBJECT) return
  const json = rewards.toArray()

  json.forEach((jsonValue: JSONValue) => {
    const value = jsonValue.toObject()

    const vaultId = value.get('vault')
    const reward = value.get('reward')
    const proof = value.get('proof')

    if (typeof vaultId === 'string' && reward && proof) {
      const vault = Vault.load(vaultId) as Vault
      const rewardNumber = BigInt.fromI32(reward)

      if (vault) {
        vault.consensusReward = vault.consensusReward.plus(rewardNumber).minus(vault.proofReward as BigInt)
        vault.proofReward = rewardNumber
        // vault.proof = proof
      }
    }
  })
}
