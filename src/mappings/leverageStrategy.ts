import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered,
  StrategyProxyUpgraded,
} from '../../generated/AaveLeverageStrategyV1/AaveLeverageStrategy'
import { StrategyProxyCreated } from '../../generated/Keeper/AaveLeverageStrategy'
import { Aave, LeverageStrategyPosition, OsToken, OsTokenConfig, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import { createOrLoadLeverageStrategyPosition, updateLeveragePosition } from '../entities/leverageStrategy'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, loadOsToken } from '../entities/osToken'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorApy,
  getAllocatorAssets,
  loadAllocator,
} from '../entities/allocator'
import { isMainMetaVault, updateStaker } from '../entities/staker'
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
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { AAVE_LEVERAGE_STRATEGY_V1 } from '../helpers/constants'

function _updateAllocator(
  aave: Aave,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  osToken: OsToken,
  position: LeverageStrategyPosition,
  earnedOsTokenShares: BigInt,
  earnedAssets: BigInt,
): void {
  // update allocator
  const userAddress = Address.fromBytes(position.user)
  const vaultAddr = Address.fromString(vault.id)
  const allocator = loadAllocator(userAddress, vaultAddr)
  if (!allocator) {
    log.error('[LeverageStrategy] _updateAllocator allocator not found for user={} vault={}', [
      userAddress.toHex(),
      vaultAddr.toHex(),
    ])
    return
  }
  allocator._periodBoostEarnedOsTokenShares = allocator._periodBoostEarnedOsTokenShares.plus(earnedOsTokenShares)
  allocator._periodBoostEarnedAssets = allocator._periodBoostEarnedAssets.plus(earnedAssets)
  allocator.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator, false)
  allocator.totalAssets = getAllocatorAssets(osToken, osTokenConfig, allocator, false)
  allocator.save()

  if (isMainMetaVault(vaultAddr)) {
    updateStaker(userAddress)
  }
}

export function handleStrategyProxyCreated(event: StrategyProxyCreated): void {
  const vaultAddress = event.params.vault
  const userAddress = event.params.user
  const proxyAddress = event.params.proxy
  if (!loadVault(vaultAddress)) {
    log.error('[LeverageStrategy] Vault not found for address={}', [vaultAddress.toHex()])
    return
  }

  createOrLoadAavePosition(proxyAddress)
  createOrLoadAllocator(proxyAddress, vaultAddress)

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress, event.address)
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
  const osToken = loadOsToken()!
  const vault = loadVault(vaultAddress)
  if (!vault) {
    log.error('[LeverageStrategy] Vault not found for address={}', [vaultAddress.toHex()])
    return
  }
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  // create allocator if user wasn't depositing to the vault before
  createOrLoadAllocator(userAddress, vaultAddress)
  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress, event.address)

  const totalOsTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const totalAssetsBefore = position.assets.plus(position.exitingAssets)

  // update position with new shares and assets
  updateAavePosition(createOrLoadAavePosition(Address.fromBytes(position.proxy)))
  updateLeveragePosition(aave, osToken, position)

  const totalOsTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const totalAssetsAfter = position.assets.plus(position.exitingAssets)

  _updateAllocator(
    aave,
    vault,
    osTokenConfig,
    osToken,
    position,
    totalOsTokenSharesAfter.minus(totalOsTokenSharesBefore).minus(depositedOsTokenShares),
    totalAssetsAfter.minus(totalAssetsBefore),
  )

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
  const vault = loadVault(vaultAddress)
  if (!vault) {
    log.error('[LeverageStrategy] Vault not found for address={}', [vaultAddressHex])
    return
  }
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress, event.address)

  const totalOsTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const totalAssetsBefore = position.assets.plus(position.exitingAssets)

  // update position with new shares and assets
  position.exitRequest = `${vaultAddressHex}-${positionTicket}`
  position.exitingPercent = exitingPercent
  updateLeveragePosition(aave, osToken, position)

  const totalOsTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const totalAssetsAfter = position.assets.plus(position.exitingAssets)
  _updateAllocator(
    aave,
    vault,
    osTokenConfig,
    osToken,
    position,
    totalOsTokenSharesAfter.minus(totalOsTokenSharesBefore),
    totalAssetsAfter.minus(totalAssetsBefore),
  )

  createAllocatorAction(
    event,
    vaultAddress,
    AllocatorActionType.BoostExitQueueEntered,
    userAddress,
    null,
    position.exitingOsTokenShares.plus(convertAssetsToOsTokenShares(osToken, position.exitingAssets)),
  )

  createTransaction(event.transaction.hash.toHex())

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
  const claimedAssets = event.params.assets

  const osToken = loadOsToken()!
  const aave = loadAave()!
  const vault = loadVault(vaultAddress)
  if (!vault) {
    log.error('[LeverageStrategy] Vault not found for address={}', [vaultAddress.toHex()])
    return
  }
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress, event.address)

  const totalOsTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const totalAssetsBefore = position.assets.plus(position.exitingAssets)

  // update position with new shares and assets
  position.exitRequest = null
  position.exitingPercent = BigInt.zero()
  updateAavePosition(loadAavePosition(Address.fromBytes(position.proxy))!)
  updateLeveragePosition(aave, osToken, position)

  const totalOsTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
  const totalAssetsAfter = position.assets.plus(position.exitingAssets)
  _updateAllocator(
    aave,
    vault,
    osTokenConfig,
    osToken,
    position,
    totalOsTokenSharesAfter.plus(claimedOsTokenShares).minus(totalOsTokenSharesBefore),
    totalAssetsAfter.plus(claimedAssets).minus(totalAssetsBefore),
  )

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

export function handleStrategyProxyUpgraded(event: StrategyProxyUpgraded): void {
  const newStrategy = event.params.strategy
  const vaultAddress = event.params.vault
  const userAddress = event.params.user

  const position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress, newStrategy)
  position.version = newStrategy.equals(AAVE_LEVERAGE_STRATEGY_V1) ? BigInt.fromI32(1) : BigInt.fromI32(2)
  position.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[LeverageStrategy] StrategyProxyUpgraded vault={} user={} newStrategy={}', [
    vaultAddress.toHex(),
    userAddress.toHex(),
    newStrategy.toHex(),
  ])
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
      const position = leveragePositions[j]
      if (
        position.osTokenShares.isZero() &&
        position.assets.isZero() &&
        position.exitingOsTokenShares.isZero() &&
        position.exitingAssets.isZero()
      ) {
        // skip empty positions
        continue
      }

      const totalOsTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
      const totalAssetsBefore = position.assets.plus(position.exitingAssets)

      // update position with new shares and assets
      updateLeveragePosition(aave, osToken, position)

      const totalOsTokenSharesAfter = position.osTokenShares.plus(position.exitingOsTokenShares)
      const totalAssetsAfter = position.assets.plus(position.exitingAssets)

      // update allocator
      const userAddress = Address.fromBytes(position.user)
      const vaultAddr = Address.fromString(vault.id)
      const allocator = loadAllocator(userAddress, vaultAddr)
      if (!allocator) {
        log.error('[LeverageStrategy] syncLeverageStrategyPositions allocator not found for user={} vault={}', [
          userAddress.toHex(),
          vaultAddr.toHex(),
        ])
        continue
      }
      allocator._periodBoostEarnedOsTokenShares = allocator._periodBoostEarnedOsTokenShares.plus(
        totalOsTokenSharesAfter.minus(totalOsTokenSharesBefore),
      )
      allocator._periodBoostEarnedAssets = allocator._periodBoostEarnedAssets.plus(
        totalAssetsAfter.minus(totalAssetsBefore),
      )
      allocator.save()
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
