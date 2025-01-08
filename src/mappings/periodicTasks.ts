import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { loadVault, snapshotVault, updateVaultMaxBoostApy } from '../entities/vault'
import { loadOsToken, snapshotOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import { Allocator, Network, OsTokenConfig, OsTokenHolder, Vault } from '../../generated/schema'
import {
  getAllocatorApy,
  getAllocatorsMintedShares,
  snapshotAllocator,
  updateAllocatorMintedOsTokenShares,
} from '../entities/allocator'
import { updateExitRequests } from '../entities/exitRequest'
import { getOsTokenHolderApy, snapshotOsTokenHolder, updateOsTokenHolderAssets } from '../entities/osTokenHolder'
import { updateOsTokenExitRequests } from '../entities/osTokenVaultEscrow'
import { updateLeverageStrategyPositions } from '../entities/leverageStrategy'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadAave, updateAaveApys, updateAavePositions } from '../entities/aave'
import { loadDistributor, updateDistributions } from '../entities/merkleDistributor'

const secondsInHour = 3600
const secondsInDay = 86400

export function handlePeriodicTasks(block: ethereum.Block): void {
  const timestamp = block.timestamp
  const blockNumber = block.number
  const network = loadNetwork()
  const aave = loadAave()
  if (!network || !aave) {
    return
  }

  // update Aave
  // NB! if blocksInHour config is updated, the average apy calculation must be updated
  updateAaveApys(aave, block.number)
  updateAavePositions(aave)

  // update osToken
  const osToken = loadOsToken()!
  updateOsTokenTotalAssets(osToken)

  // update assets of all the osToken holders
  let osTokenHolder: OsTokenHolder
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    updateOsTokenHolderAssets(osToken, osTokenHolder)
  }

  // update distributions
  // NB! if blocksInHour config is updated, the average apy calculation must be updated
  const distributor = loadDistributor()!
  updateDistributions(network, osToken, distributor, timestamp)

  const vaultIds = network.vaultIds
  let vaultAddress: Address
  let vault: Vault
  let osTokenConfig: OsTokenConfig | null
  for (let i = 0; i < vaultIds.length; i++) {
    vaultAddress = Address.fromString(vaultIds[i])
    vault = loadVault(vaultAddress)!
    osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

    // update allocators
    let allocator: Allocator
    let allocators: Array<Allocator> = vault.allocators.load()
    const allocatorsMintedOsTokenShares = getAllocatorsMintedShares(vault, allocators)
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      updateAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, allocatorsMintedOsTokenShares[j])
    }

    // update exit requests
    updateExitRequests(network, vault, timestamp)

    // update OsToken exit requests
    updateOsTokenExitRequests(osToken, vault)

    // update leverage strategy positions
    updateLeverageStrategyPositions(network, aave, osToken, vault)

    // update allocators apys
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator, false)
      allocator.save()
    }

    // update vault max boost apys
    updateVaultMaxBoostApy(aave, osToken, vault, osTokenConfig, distributor, blockNumber)
  }

  // update osToken holders apys
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    osTokenHolder.apy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder, false)
    osTokenHolder.save()
  }

  // Update snapshots
  _updateSnapshots(network, timestamp)

  log.info('[PeriodicTasks] block={} timestamp={}', [blockNumber.toString(), timestamp.toString()])
}

function _updateSnapshots(network: Network, timestamp: BigInt): void {
  const newSnapshotsCount = timestamp.plus(BigInt.fromI32(secondsInHour)).div(BigInt.fromI32(secondsInDay))
  const prevSnapshotsCount = network.lastSnapshotTimestamp
    .plus(BigInt.fromI32(secondsInHour))
    .div(BigInt.fromI32(secondsInDay))
  if (newSnapshotsCount.le(prevSnapshotsCount)) {
    return
  }
  if (network.lastSnapshotTimestamp.isZero()) {
    // skip first snapshot
    network.lastSnapshotTimestamp = timestamp
    network.save()
    return
  }

  const duration = timestamp.minus(network.lastSnapshotTimestamp)
  network.lastSnapshotTimestamp = timestamp
  network.save()

  const osToken = loadOsToken()
  if (!osToken) {
    return
  }
  snapshotOsToken(osToken, osToken._periodEarnedAssets, timestamp)
  osToken._periodEarnedAssets = BigInt.zero()
  osToken.save()

  let osTokenHolder: OsTokenHolder
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    snapshotOsTokenHolder(network, osToken, osTokenHolder, osTokenHolder._periodEarnedAssets, duration, timestamp)
    osTokenHolder._periodEarnedAssets = BigInt.zero()
    osTokenHolder.save()
  }

  let vault: Vault
  const vaultIds = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    vault = loadVault(Address.fromString(vaultIds[i]))!
    snapshotVault(vault, BigInt.zero(), timestamp)

    const allocators: Array<Allocator> = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      const allocator = allocators[j]
      snapshotAllocator(osToken, vault, allocator, allocator._periodEarnedAssets, duration, timestamp)
      allocator._periodEarnedAssets = BigInt.zero()
      allocator.save()
    }
  }
  log.info('[PeriodicTasks] snapshots updated timestamp={}', [timestamp.toString()])
}
