import { BigInt, log } from '@graphprotocol/graph-ts'

import { Allocator } from '../../generated/schema'
import { XdaiSwapped } from '../../generated/templates/GnoVault/GnoVault'
import { WAD } from '../helpers/constants'
import { loadNetwork } from '../entities/network'
import { getAllocatorApy, updateAllocatorAssets } from '../entities/allocator'
import { convertSharesToAssets, loadVault, snapshotVault, updateVaultApy } from '../entities/vault'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadOsToken } from '../entities/osToken'
import { loadDistributor } from '../entities/merkleDistributor'

// Event emitted when xDAI is swapped to GNO
export function handleXdaiSwapped(event: XdaiSwapped): void {
  const params = event.params
  const vaultAddress = event.address
  const timestamp = event.block.timestamp
  const xdaiAssets = params.amount
  const gnoAssets = params.assets
  const vault = loadVault(vaultAddress)!
  const osToken = loadOsToken()!
  const distributor = loadDistributor()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  let v2PoolRewardAssets = BigInt.zero()
  if (vault.isGenesis) {
    const v2Pool = createOrLoadV2Pool()
    v2PoolRewardAssets = gnoAssets.times(v2Pool.totalAssets).div(v2Pool.totalAssets.plus(vault.totalAssets))
    v2Pool.rewardAssets = v2Pool.rewardAssets.plus(v2PoolRewardAssets)
    v2Pool.save()
  }
  const vaultRewardAssets = gnoAssets.minus(v2PoolRewardAssets)
  vault.totalAssets = vault.totalAssets.plus(vaultRewardAssets)

  const feeRecipientAssets = vaultRewardAssets.times(BigInt.fromI32(vault.feePercent)).div(BigInt.fromI32(10000))
  let feeRecipientShares: BigInt
  if (vault.totalShares.isZero()) {
    feeRecipientShares = feeRecipientAssets
  } else {
    feeRecipientShares = feeRecipientAssets.times(vault.totalShares).div(vault.totalAssets.minus(feeRecipientAssets))
  }
  vault.totalShares = vault.totalShares.plus(feeRecipientShares)

  let newRate = convertSharesToAssets(vault, BigInt.fromString(WAD))
  // if (isDevirsifyVault(vault) && vault.feePercent.equals(10000)) {
  //   // diversify vault have 100% fee so we calculate rate
  //   newRate = getDiversifyVaultRate(vault, vaultRewardAssets)
  // }

  updateVaultApy(
    vault,
    distributor,
    osToken,
    vault.lastXdaiSwappedTimestamp,
    timestamp,
    vault.rate.minus(newRate),
    true,
  )
  vault.rate = newRate
  vault.lastXdaiSwappedTimestamp = timestamp
  vault.save()
  snapshotVault(vault, distributor, osToken, vaultRewardAssets, timestamp)

  const network = loadNetwork()!
  network.totalAssets = network.totalAssets.plus(gnoAssets)
  network.totalEarnedAssets = network.totalEarnedAssets.plus(gnoAssets)
  network.save()

  // update allocators
  let allocator: Allocator
  let allocators: Array<Allocator> = vault.allocators.load()
  for (let j = 0; j < allocators.length; j++) {
    allocator = allocators[j]
    const earnedAssets = updateAllocatorAssets(osToken, osTokenConfig, vault, allocator)
    allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator)
    allocator._periodEarnedAssets = allocator._periodEarnedAssets.plus(earnedAssets)
    allocator.save()
  }

  log.info('[GnoVault] XdaiSwapped vault={} xdai={} gno={}', [
    vaultAddress.toHexString(),
    xdaiAssets.toString(),
    gnoAssets.toString(),
  ])
}
