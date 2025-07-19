import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered,
} from '../../generated/AaveLeverageStrategy/AaveLeverageStrategy'
import { StrategyProxyCreated } from '../../generated/Keeper/AaveLeverageStrategy'
import {
  Distributor,
  LeverageStrategyPosition,
  Network,
  OsToken,
  OsTokenConfig,
  Vault,
  Aave,
} from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadLeverageStrategyPosition,
  updateLeveragePositionOsTokenSharesAndAssets,
  updateLeveragePositionPeriodEarnedAssets,
} from '../entities/leverageStrategy'
import { convertOsTokenSharesToAssets, loadOsToken } from '../entities/osToken'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorApy,
  loadAllocator,
} from '../entities/allocator'
import { getOsTokenHolderApy, loadOsTokenHolder } from '../entities/osTokenHolder'
import { loadNetwork } from '../entities/network'
import { loadVault } from '../entities/vault'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import {
  createOrLoadAavePosition,
  loadAave,
  loadAavePosition,
  updateAavePosition,
  updateAavePositions,
} from '../entities/aave'
import { loadDistributor } from '../entities/merkleDistributor'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'

function _updateAllocatorAndOsTokenHolderApys(
  aave: Aave,
  network: Network,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  distributor: Distributor,
  vault: Vault,
  userAddress: Address,
): void {
  const allocator = loadAllocator(userAddress, Address.fromString(vault.id))
  if (allocator) {
    allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, distributor, allocator)
    allocator.save()
  }
  const osTokenHolder = loadOsTokenHolder(userAddress)!
  osTokenHolder.apy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder)
  osTokenHolder.save()
}

export function handleStrategyProxyCreated(event: StrategyProxyCreated): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const proxyAddress = event.params.proxy

  createOrLoadAavePosition(proxyAddress)
  createOrLoadAllocator(proxyAddress, vaultAddress)

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  position.proxy = proxyAddress
  position.save()

  log.info('[LeverageStrategy] StrategyProxyCreated vault={} user={} proxy={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    proxyAddress.toHex(),
  ])
}

export function handleDeposited(event: Deposited): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const depositedOsTokenShares = event.params.osTokenShares

  const aave = loadAave()!
  const network = loadNetwork()!
  const osToken = loadOsToken()!
  const distributor = loadDistributor()!
  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  // create allocator if user wasn't depositing to the vault before
  createOrLoadAllocator(userAddress, vaultAddress)
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  updateLeveragePositionPeriodEarnedAssets(network, aave, osToken, vault, position)

  // update position with new shares and assets
  updateAavePosition(createOrLoadAavePosition(Address.fromBytes(position.proxy)))
  updateLeveragePositionOsTokenSharesAndAssets(aave, osToken, position)
  _updateAllocatorAndOsTokenHolderApys(aave, network, osToken, osTokenConfig, distributor, vault, userAddress)

  createTransaction(event.transaction.hash.toHex())

  createAllocatorAction(
    event,
    vaultAddress,
    AllocatorActionType.BoostDeposited,
    userAddress,
    convertOsTokenSharesToAssets(osToken, depositedOsTokenShares),
    depositedOsTokenShares,
  )

  log.info('[LeverageStrategy] Deposited vault={} user={} osTokenShares={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    depositedOsTokenShares.toString(),
  ])
}

export function handleExitQueueEntered(event: ExitQueueEntered): void {
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()
  const userAddress = event.params.user
  const positionTicket = event.params.positionTicket
  const exitingPercent = event.params.positionPercent

  const aave = loadAave()!
  const osToken = loadOsToken()!
  const network = loadNetwork()!
  const vault = loadVault(vaultAddress)!
  const distributor = loadDistributor()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  updateLeveragePositionPeriodEarnedAssets(network, aave, osToken, vault, position)

  // update position with new shares and assets
  position.exitRequest = `${vaultAddressHex}-${positionTicket}`
  position.exitingPercent = exitingPercent
  updateLeveragePositionOsTokenSharesAndAssets(aave, osToken, position)
  _updateAllocatorAndOsTokenHolderApys(aave, network, osToken, osTokenConfig, distributor, vault, userAddress)

  log.info('[LeverageStrategy] ExitQueueEntered vault={} user={} positionTicket={}', [
    vaultAddressHex,
    userAddress.toHex(),
    positionTicket.toString(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const claimedOsTokenShares = event.params.osTokenShares

  const osToken = loadOsToken()!
  const network = loadNetwork()!
  const aave = loadAave()!
  const distributor = loadDistributor()!
  const vault = loadVault(vaultAddress)!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
  updateLeveragePositionPeriodEarnedAssets(network, aave, osToken, vault, position)

  // update position with new shares and assets
  position.exitRequest = null
  position.exitingPercent = BigInt.zero()
  updateAavePosition(loadAavePosition(Address.fromBytes(position.proxy))!)
  updateLeveragePositionOsTokenSharesAndAssets(aave, osToken, position)
  _updateAllocatorAndOsTokenHolderApys(aave, network, osToken, osTokenConfig, distributor, vault, userAddress)

  createAllocatorAction(
    event,
    vaultAddress,
    AllocatorActionType.BoostExitedAssetsClaimed,
    userAddress,
    convertOsTokenSharesToAssets(osToken, claimedOsTokenShares),
    claimedOsTokenShares,
  )

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] ExitedAssetsClaimed vault={} user={}', [vaultAddress.toHex(), userAddress.toHex()])
}

export function syncLeverageStrategyPositions(block: ethereum.Block): void {
  const network = loadNetwork()
  const osToken = loadOsToken()
  const aave = loadAave()

  if (!network || !osToken || !aave) {
    log.warning('[SyncLeverageStrategyPositions] OsToken or Network or Aave not found', [])
    return
  }

  const osTokenCheckpoint = createOrLoadCheckpoint(CheckpointType.OS_TOKEN)
  const leverageStrategyCheckpoint = createOrLoadCheckpoint(CheckpointType.LEVERAGE_STRATEGY)
  if (osTokenCheckpoint.timestamp.lt(leverageStrategyCheckpoint.timestamp)) {
    return
  }

  // update Aave positions
  updateAavePositions(aave)

  let vault: Vault
  const vaultIds = network.vaultIds
  const totalVaults = vaultIds.length
  for (let i = 0; i < totalVaults; i++) {
    vault = loadVault(Address.fromString(vaultIds[i]))!
    if (!vault.isOsTokenEnabled) {
      continue
    }

    // update leverage strategy positions
    const leveragePositions: Array<LeverageStrategyPosition> = vault.leveragePositions.load()
    for (let j = 0; j < leveragePositions.length; j++) {
      updateLeveragePositionPeriodEarnedAssets(network, aave, osToken, vault, leveragePositions[j])
    }
  }

  const newTimestamp = block.timestamp
  leverageStrategyCheckpoint.timestamp = newTimestamp
  leverageStrategyCheckpoint.save()

  log.info('[SyncLeverageStrategyPositions] Leverage strategy positions synced totalVaults={} timestamp={}', [
    totalVaults.toString(),
    newTimestamp.toString(),
  ])
}
