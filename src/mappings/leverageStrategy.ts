import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import {
  Deposited,
  ExitedAssetsClaimed,
  ExitQueueEntered,
} from '../../generated/AaveLeverageStrategy/AaveLeverageStrategy'
import { StrategyProxyCreated } from '../../generated/Keeper/AaveLeverageStrategy'
import { Distributor, Network, OsToken, OsTokenConfig, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'
import {
  createOrLoadLeverageStrategyPosition,
  loadLeverageStrategyPosition,
  updateLeverageStrategyPosition,
  updatePeriodEarnedAssets,
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
import { getIsOsTokenVault, loadNetwork } from '../entities/network'
import { loadVault } from '../entities/vault'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { createOrLoadAavePosition, loadAave, loadAavePosition, updateAavePosition } from '../entities/aave'
import { loadDistributor } from '../entities/merkleDistributor'
import { WAD } from '../helpers/constants'

function _updateAllocatorAndOsTokenHolderApys(
  network: Network,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  distributor: Distributor,
  vault: Vault,
  userAddress: Address,
): void {
  const allocator = loadAllocator(userAddress, Address.fromString(vault.id))
  if (allocator) {
    allocator.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator, false)
    allocator.save()
  }
  const osTokenHolder = loadOsTokenHolder(userAddress)!
  osTokenHolder.apy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder, false)
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

  let position = loadLeverageStrategyPosition(vaultAddress, userAddress)
  let ignoreSnapshot = false
  if (!position) {
    // in holesky some proxies were created by untracked strategy
    ignoreSnapshot = true
    position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
    log.error('[LeverageStrategy] Deposited position not found vault={} user={}', [
      vaultAddress.toHex(),
      userAddress.toHex(),
    ])
  }

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets

  updateAavePosition(createOrLoadAavePosition(Address.fromBytes(position.proxy)))
  updateLeverageStrategyPosition(aave, osToken, position)
  _updateAllocatorAndOsTokenHolderApys(network, osToken, osTokenConfig, distributor, vault, userAddress)

  if (!ignoreSnapshot && osTokenSharesBefore.gt(BigInt.zero())) {
    updatePeriodEarnedAssets(
      osToken,
      vault,
      totalAssetsBefore.plus(convertOsTokenSharesToAssets(osToken, depositedOsTokenShares)),
      assetsBefore,
      osTokenSharesBefore.plus(depositedOsTokenShares),
      getIsOsTokenVault(network, vault),
      position,
    )
  }

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

  let position = loadLeverageStrategyPosition(vaultAddress, userAddress)
  let ignoreSnapshot = false
  if (!position) {
    // in holesky some proxies were created by untracked strategy
    ignoreSnapshot = true
    position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
    log.error('[LeverageStrategy] ExitQueueEntered position not found vault={} user={}', [
      vaultAddress.toHex(),
      userAddress.toHex(),
    ])
  }

  const osTokenSharesBefore = position.osTokenShares.plus(position.exitingOsTokenShares)
  const assetsBefore = position.assets.plus(position.exitingAssets)
  const totalAssetsBefore = position.totalAssets
  position.exitRequest = `${vaultAddressHex}-${positionTicket}`
  position.exitingPercent = exitingPercent

  updateLeverageStrategyPosition(aave, osToken, position)
  _updateAllocatorAndOsTokenHolderApys(network, osToken, osTokenConfig, distributor, vault, userAddress)

  if (!ignoreSnapshot) {
    updatePeriodEarnedAssets(
      osToken,
      vault,
      totalAssetsBefore,
      assetsBefore,
      osTokenSharesBefore,
      getIsOsTokenVault(network, vault),
      position,
    )
  }

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

  let position = loadLeverageStrategyPosition(vaultAddress, userAddress)
  let ignoreSnapshot = false
  if (!position) {
    // in holesky some proxies were created by untracked strategy
    ignoreSnapshot = true
    position = createOrLoadLeverageStrategyPosition(vaultAddress, userAddress)
    log.error('[LeverageStrategy] ExitedAssetsClaimed position not found vault={} user={}', [
      vaultAddress.toHex(),
      userAddress.toHex(),
    ])
  }

  const osTokenSharesBefore = position.osTokenShares
  const assetsBefore = position.assets
  const totalAssetsBefore = position.totalAssets.minus(
    position.totalAssets.times(position.exitingPercent).div(BigInt.fromString(WAD)),
  )

  position.exitRequest = null
  position.exitingPercent = BigInt.zero()

  updateAavePosition(loadAavePosition(Address.fromBytes(position.proxy))!)
  updateLeverageStrategyPosition(aave, osToken, position)
  _updateAllocatorAndOsTokenHolderApys(network, osToken, osTokenConfig, distributor, vault, userAddress)

  if (!ignoreSnapshot) {
    updatePeriodEarnedAssets(
      osToken,
      vault,
      totalAssetsBefore,
      assetsBefore,
      osTokenSharesBefore,
      getIsOsTokenVault(network, vault),
      position,
    )
  }

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
