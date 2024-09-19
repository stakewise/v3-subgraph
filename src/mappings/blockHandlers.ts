import { Address, ethereum, log } from '@graphprotocol/graph-ts'
import { Vault } from '../../generated/schema'
import { updateExitRequests } from '../entities/exitRequests'
import { createOrLoadNetwork } from '../entities/network'
import { GENESIS_VAULT } from '../helpers/constants'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { updateRewardSplitters } from '../entities/rewardSplitter'

export function runBlockHandlers(block: ethereum.Block): void {
  const network = createOrLoadNetwork()
  let vaultAddr: string
  for (let i = 0; i < network.vaultIds.length; i++) {
    vaultAddr = network.vaultIds[i]
    if (Address.fromString(vaultAddr).equals(GENESIS_VAULT)) {
      const v2Pool = createOrLoadV2Pool()
      if (!v2Pool.migrated) {
        // wait for the migration
        continue
      }
    }
    const vault = Vault.load(vaultAddr) as Vault
    updateExitRequests(vault, block)
    updateRewardSplitters(vault)
  }
  log.info('[BlockHandlers] Sync block handlers at block={}', [block.number.toString()])
}
