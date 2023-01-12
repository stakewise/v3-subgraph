import { RewardsRootUpdated } from '../../generated/templates/Keeper/Keeper'
import { Vault } from '../../generated/schema'


export function handleRewardsRootUpdated(event: RewardsRootUpdated): void {
  const vaultId = event.address.toHex()
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash

  const vault = Vault.load(vaultId) as Vault

  // vault.rewardsRoot = rewardsRoot
}
