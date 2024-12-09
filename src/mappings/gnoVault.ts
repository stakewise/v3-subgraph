import { BigInt, log } from '@graphprotocol/graph-ts'

import { Allocator, Vault } from '../../generated/schema'
import { XdaiSwapped } from '../../generated/templates/GnoVault/GnoVault'
import { convertSharesToAssets, snapshotVault } from '../entities/vaults'
import { createOrLoadNetwork } from '../entities/network'
import { getAllocatorApy, getAllocatorLtv, getAllocatorLtvStatus, snapshotAllocator } from '../entities/allocator'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { createOrLoadOsToken } from '../entities/osToken'

// Event emitted when xDAI is swapped to GNO
export function handleXdaiSwapped(event: XdaiSwapped): void {
  const params = event.params
  const vaultAddress = event.address
  const timestamp = event.block.timestamp
  const gnoAssets = params.assets
  const xdaiAssets = params.amount

  const vault = Vault.load(vaultAddress.toHex()) as Vault
  vault.totalAssets = vault.totalAssets.plus(gnoAssets)
  vault.save()
  snapshotVault(vault, gnoAssets, timestamp)

  const network = createOrLoadNetwork()
  network.totalAssets = network.totalAssets.plus(gnoAssets)
  network.totalEarnedAssets = network.totalEarnedAssets.plus(gnoAssets)
  network.save()

  // update allocators
  const osToken = createOrLoadOsToken()
  let allocator: Allocator
  let allocatorAssetsDiff: BigInt
  let allocatorNewAssets: BigInt
  let allocators: Array<Allocator> = vault.allocators.load()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
  for (let j = 0; j < allocators.length; j++) {
    allocator = allocators[j]
    if (allocator.shares.isZero()) {
      continue
    }
    allocatorNewAssets = convertSharesToAssets(vault, allocator.shares)
    allocatorAssetsDiff = allocatorNewAssets.minus(allocator.assets)
    allocator.assets = allocatorNewAssets
    allocator.ltv = getAllocatorLtv(allocator, osToken)
    allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
    allocator.apy = getAllocatorApy(allocator, vault, osToken, osTokenConfig)
    allocator.save()
    snapshotAllocator(allocator, osToken, osTokenConfig, allocatorAssetsDiff, BigInt.zero(), timestamp)
  }

  log.info('[GnoVault] XdaiSwapped vault={} xdai={} gno={}', [
    vaultAddress.toHexString(),
    xdaiAssets.toString(),
    gnoAssets.toString(),
  ])
}
