import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { loadVault, updateVaultMaxBoostApy } from '../entities/vault'
import { loadOsToken, snapshotOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import { AavePosition, Allocator, OsTokenConfig, OsTokenHolder, Vault } from '../../generated/schema'
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
import { loadAave, updateAaveApys, updateAavePosition } from '../entities/aave'
import { loadDistributor, updateDistributions } from '../entities/merkleDistributor'

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
  const positions: Array<AavePosition> = aave.positions.load()
  for (let i = 0; i < positions.length; i++) {
    updateAavePosition(positions[i])
  }

  // update osToken
  const osToken = loadOsToken()!
  const osTokenAssetsDiff = updateOsTokenTotalAssets(osToken)
  snapshotOsToken(osToken, osTokenAssetsDiff, timestamp)

  // update assets of all the osToken holders
  let osTokenHolder: OsTokenHolder
  const osTokenHolderAssetsDiffs: Array<BigInt> = []
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    osTokenHolderAssetsDiffs.push(updateOsTokenHolderAssets(osToken, osTokenHolder))
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
    let mintedOsTokenAssetsDiff: Array<BigInt> = []
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      mintedOsTokenAssetsDiff.push(
        updateAllocatorMintedOsTokenShares(osToken, osTokenConfig, allocator, allocatorsMintedOsTokenShares[j]),
      )
    }

    // update exit requests
    updateExitRequests(vault, timestamp)

    // update OsToken exit requests
    updateOsTokenExitRequests(osToken, vault)

    // update leverage strategy positions
    updateLeverageStrategyPositions(osToken, vault, timestamp)

    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator, false)
      allocator.save()
      snapshotAllocator(
        osToken,
        osTokenConfig,
        vault,
        distributor,
        allocator,
        mintedOsTokenAssetsDiff[j].neg(),
        timestamp,
      )
    }

    // update vault max boost apys
    updateVaultMaxBoostApy(aave, osToken, vault, osTokenConfig, distributor, blockNumber)
  }

  // update osToken holders apys
  for (let i = 0; i < osTokenHolders.length; i++) {
    osTokenHolder = osTokenHolders[i]
    osTokenHolder.apy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder, false)
    osTokenHolder.save()
    snapshotOsTokenHolder(network, osToken, distributor, osTokenHolder, osTokenHolderAssetsDiffs[i], timestamp)
  }
  log.info('[PeriodicTasks] block={} timestamp={}', [blockNumber.toString(), timestamp.toString()])
}
