import { Address, ethereum, log } from '@graphprotocol/graph-ts'
import { loadVault, updateVaultMaxBoostApy } from '../entities/vault'
import { loadOsToken, updateOsTokenTotalAssets } from '../entities/osToken'
import { loadNetwork } from '../entities/network'
import { Allocator, OsTokenConfig, OsTokenHolder, Vault } from '../../generated/schema'
import { getAllocatorApy, getAllocatorsMintedShares, updateAllocatorMintedOsTokenShares } from '../entities/allocator'
import { updateExitRequests } from '../entities/exitRequest'
import { getOsTokenHolderApy, updateOsTokenHolderAssets } from '../entities/osTokenHolder'
import { updateOsTokenExitRequests } from '../entities/osTokenVaultEscrow'
import { updateLeverageStrategyPositions } from '../entities/leverageStrategy'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadAave, updateAaveApys, updateAavePositions } from '../entities/aave'
import { loadDistributor, updateDistributions } from '../entities/merkleDistributor'
import { loadExchangeRate } from '../entities/exchangeRates'

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
  updateDistributions(network, exchangeRate, osToken, distributor, timestamp)

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
  log.info('[PeriodicTasks] block={} timestamp={}', [blockNumber.toString(), timestamp.toString()])
}
