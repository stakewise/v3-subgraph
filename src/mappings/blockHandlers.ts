import { BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { Vault } from '../../generated/schema'
import { createOrLoadOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { updateAllocatorsMintedOsTokenShares, updateExitRequests } from '../entities/allocator'
import { createOrLoadNetwork } from '../entities/network'

export function syncUpdates(block: ethereum.Block): void {
  const osToken = createOrLoadOsToken()
  updateOsTokenTotalAssets(osToken)
  osToken.save()

  if (osToken.totalSupply.equals(BigInt.zero()) || osToken.totalAssets.equals(BigInt.zero())) {
    return
  }

  const network = createOrLoadNetwork()
  for (let i = 0; i < network.vaultIds.length; i++) {
    const vaultAddr = network.vaultIds[i]
    const vault = Vault.load(vaultAddr) as Vault
    updateAllocatorsMintedOsTokenShares(vault)
    updateExitRequests(vault)
  }
  log.info('[BlockHandlers] Sync updates at block={}', [block.number.toString()])
}
