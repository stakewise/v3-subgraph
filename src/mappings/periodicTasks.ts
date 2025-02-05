import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { loadVault, snapshotVault, updateVaultMaxBoostApy } from '../entities/vault'
import { loadOsToken, snapshotOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import {
  Allocator,
  Distributor,
  ExitRequest,
  Network,
  OsTokenConfig,
  OsTokenHolder,
  Vault,
} from '../../generated/schema'
import { getAllocatorApy, snapshotAllocator, updateAllocatorsMintedOsTokenShares } from '../entities/allocator'
import { getOsTokenHolderApy, snapshotOsTokenHolder, updateOsTokenHolderAssets } from '../entities/osTokenHolder'
import { updateOsTokenExitRequests } from '../entities/osTokenVaultEscrow'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadAave, updateAaveApys } from '../entities/aave'
import { loadDistributor, updateDistributions } from '../entities/merkleDistributor'
import { loadExchangeRate } from '../entities/exchangeRates'

const secondsInHour = 3600
const secondsInDay = 86400

export function handlePeriodicTasks(block: ethereum.Block): void {
  const timestamp = block.timestamp
  const blockNumber = block.number
  const network = loadNetwork()
  const exchangeRate = loadExchangeRate()
  const aave = loadAave()
  if (!network || !exchangeRate || !aave) {
    return
  }

  // update Aave
  // NB! if blocksInHour config is updated, the average apy calculation must be updated
  updateAaveApys(aave, block.number)

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
  updateDistributions(network, exchangeRate, osToken, distributor, timestamp)

  const vaultIds = network.vaultIds
  let vaultAddress: Address
  let vault: Vault
  let osTokenConfig: OsTokenConfig | null
  for (let i = 0; i < vaultIds.length; i++) {
    vaultAddress = Address.fromString(vaultIds[i])
    vault = loadVault(vaultAddress)!
    osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

    // update exit requests
    let exitRequest: ExitRequest
    const exitRequests: Array<ExitRequest> = vault.exitRequests.load()
    for (let i = 0; i < exitRequests.length; i++) {
      exitRequest = exitRequests[i]
      if (exitRequest.exitedAssets.gt(BigInt.zero()) && !exitRequest.isClaimed && !exitRequest.isClaimable) {
        const isClaimable = exitRequest.timestamp.plus(BigInt.fromI32(secondsInDay)).lt(timestamp)
        if (isClaimable) {
          exitRequest.isClaimable = isClaimable
          exitRequest.save()
        }
      }
    }

    if (!vault.isOsTokenEnabled) {
      continue
    }

    // update allocators minted osToken shares
    updateAllocatorsMintedOsTokenShares(osToken, osTokenConfig, vault)

    // update OsToken exit requests
    updateOsTokenExitRequests(osToken, vault)

    // update allocators apys
    let allocator: Allocator
    let allocatorApy: BigDecimal
    const allocators: Array<Allocator> = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      allocatorApy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator)
      if (allocatorApy.equals(allocator.apy)) {
        continue
      }
      allocator.apy = allocatorApy
      allocator.save()
    }

    // update vault max boost apys
    updateVaultMaxBoostApy(aave, osToken, vault, osTokenConfig, distributor, blockNumber)
  }

  // update osToken holders apys
  let osTokenHolderApy: BigDecimal
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    osTokenHolderApy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder)
    if (osTokenHolderApy.equals(osTokenHolder.apy)) {
      continue
    }
    osTokenHolder.apy = osTokenHolderApy
    osTokenHolder.save()
  }

  // Update snapshots
  _updateSnapshots(network, distributor, timestamp)

  log.info('[PeriodicTasks] block={} timestamp={}', [blockNumber.toString(), timestamp.toString()])
}

function _updateSnapshots(network: Network, distributor: Distributor, timestamp: BigInt): void {
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
    snapshotVault(vault, distributor, osToken, BigInt.zero(), timestamp)

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
