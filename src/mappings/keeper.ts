import { ipfs, json } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { RewardsRootUpdated } from '../../generated/templates/Keeper/Keeper'
import { updateRewards } from '../entities/rewards'



export function handleRewardsRootUpdated(event: RewardsRootUpdated): void {
  const vaultId = event.address.toHex()
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash

  const vault = Vault.load(vaultId) as Vault

  vault.rewardsRoot = rewardsRoot
  vault.save()

  const data = ipfs.cat(rewardsIpfsHash)

  if (data) {
    const parsedJson = json.try_fromBytes(data)

    if (parsedJson.isOk && !parsedJson.isError) {
      updateRewards(parsedJson.value)
    }
  }
}
