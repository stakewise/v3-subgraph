import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  AllocatorAction,
  AllocatorSnapshot,
  Distributor,
  ExitRequest,
  OsToken,
  OsTokenConfig,
  Vault,
} from '../../generated/schema'
import { WAD } from '../helpers/constants'
import { getAnnualReward } from '../helpers/utils'
import { convertOsTokenSharesToAssets, getOsTokenApy } from './osToken'
import { convertSharesToAssets, getVaultApy, getVaultOsTokenMintApy, loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { getBoostPositionAnnualReward, loadLeverageStrategyPosition } from './leverageStrategy'
import { Vault as VaultContract } from '../../generated/PeriodicTasks/Vault'
import { loadNetwork } from './network'
import { loadAave } from './aave'

const osTokenPositionsSelector = '0x4ec96b22'

export enum LtvStatus {
  Healthy,
  Moderate,
  Risky,
  Unhealthy,
}

export enum AllocatorActionType {
  VaultCreated,
  Deposited,
  Migrated,
  Redeemed,
  TransferIn,
  TransferOut,
  ExitQueueEntered,
  ExitedAssetsClaimed,
  OsTokenMinted,
  OsTokenBurned,
  OsTokenLiquidated,
  OsTokenRedeemed,
  BoostDeposited,
  BoostExitedAssetsClaimed,
}

const LtvStatusStrings = ['Healthy', 'Moderate', 'Risky', 'Unhealthy']

const AllocatorActionTypeStrings = [
  'VaultCreated',
  'Deposited',
  'Migrated',
  'Redeemed',
  'TransferIn',
  'TransferOut',
  'ExitQueueEntered',
  'ExitedAssetsClaimed',
  'OsTokenMinted',
  'OsTokenBurned',
  'OsTokenLiquidated',
  'OsTokenRedeemed',
  'BoostDeposited',
  'BoostExitedAssetsClaimed',
]

export function getAllocatorId(allocatorAddress: Address, vaultAddress: Address): string {
  return `${vaultAddress.toHex()}-${allocatorAddress.toHex()}`
}

export function loadAllocator(allocatorAddress: Address, vaultAddress: Address): Allocator | null {
  return Allocator.load(getAllocatorId(allocatorAddress, vaultAddress))
}

export function createOrLoadAllocator(allocatorAddress: Address, vaultAddress: Address): Allocator {
  const vaultAllocatorAddress = getAllocatorId(allocatorAddress, vaultAddress)
  let vaultAllocator = Allocator.load(vaultAllocatorAddress)

  if (vaultAllocator === null) {
    vaultAllocator = new Allocator(vaultAllocatorAddress)
    vaultAllocator.shares = BigInt.zero()
    vaultAllocator.assets = BigInt.zero()
    vaultAllocator.mintedOsTokenShares = BigInt.zero()
    vaultAllocator.ltv = BigDecimal.zero()
    vaultAllocator.ltvStatus = LtvStatusStrings[LtvStatus.Healthy]
    vaultAllocator.address = allocatorAddress
    vaultAllocator.vault = vaultAddress.toHex()
    vaultAllocator.apy = BigDecimal.zero()
    vaultAllocator.save()
  }

  return vaultAllocator
}

export function createAllocatorAction(
  event: ethereum.Event,
  vaultAddress: Address,
  actionType: AllocatorActionType,
  owner: Address,
  assets: BigInt | null,
  shares: BigInt | null,
): void {
  const allocatorActionString = AllocatorActionTypeStrings[actionType]
  if (assets === null && shares === null) {
    log.error('[AllocatorAction] Both assets and shares cannot be null for action={}', [allocatorActionString])
    return
  }
  const txHash = event.transaction.hash.toHex()
  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)
  allocatorAction.vault = vaultAddress.toHex()
  allocatorAction.address = owner
  allocatorAction.actionType = allocatorActionString
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()
}

export function getAllocatorsMintedShares(vault: Vault, allocators: Array<Allocator>): Array<BigInt> {
  if (!vault.isOsTokenEnabled) {
    let response = new Array<BigInt>(allocators.length)
    for (let i = 0; i < allocators.length; i++) {
      response[i] = BigInt.zero()
    }
    return response
  }

  const vaultAddress = Address.fromString(vault.id)
  const vaultContract = VaultContract.bind(vaultAddress)

  let calls: Array<Bytes> = []
  for (let i = 0; i < allocators.length; i++) {
    calls.push(_getOsTokenPositionsCall(allocators[i]))
  }

  const result = vaultContract.multicall(calls)
  const mintedShares: Array<BigInt> = []
  for (let i = 0; i < allocators.length; i++) {
    mintedShares.push(ethereum.decode('uint256', result[i])!.toBigInt())
  }
  return mintedShares
}

export function getAllocatorLtvStatus(allocator: Allocator, osTokenConfig: OsTokenConfig): string {
  const disabledLiqThresholdPercent = BigInt.fromI32(2).pow(64).minus(BigInt.fromI32(1))
  if (osTokenConfig.liqThresholdPercent.equals(disabledLiqThresholdPercent)) {
    return LtvStatusStrings[LtvStatus.Healthy]
  }
  const ltv = allocator.ltv
  const step = new BigDecimal(osTokenConfig.liqThresholdPercent.minus(osTokenConfig.ltvPercent))
    .div(BigDecimal.fromString('3'))
    .div(BigDecimal.fromString(WAD))
  const healthyLimit = new BigDecimal(osTokenConfig.ltvPercent).div(BigDecimal.fromString(WAD)).plus(step)
  const moderateLimit = healthyLimit.plus(step)
  const riskyLimit = moderateLimit.plus(step)
  if (ltv.le(healthyLimit)) {
    return LtvStatusStrings[LtvStatus.Healthy]
  } else if (ltv.le(moderateLimit)) {
    return LtvStatusStrings[LtvStatus.Moderate]
  } else if (ltv.le(riskyLimit)) {
    return LtvStatusStrings[LtvStatus.Risky]
  }
  return LtvStatusStrings[LtvStatus.Unhealthy]
}

export function getAllocatorLtv(allocator: Allocator, osToken: OsToken): BigDecimal {
  if (allocator.assets.isZero()) {
    return BigDecimal.zero()
  }
  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, allocator.mintedOsTokenShares)
  return new BigDecimal(mintedOsTokenAssets).div(new BigDecimal(allocator.assets))
}

export function getAllocatorApy(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  distributor: Distributor,
  allocator: Allocator,
  useDayApy: boolean,
): BigDecimal {
  const vaultAddress = Address.fromString(allocator.vault)
  const allocatorAddress = Address.fromBytes(allocator.address)

  const vaultApy = getVaultApy(vault, useDayApy)
  const osTokenApy = getOsTokenApy(osToken, useDayApy)

  let principalAssets = allocator.assets
  let totalEarnedAssets = getAnnualReward(principalAssets, vaultApy)

  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, allocator.mintedOsTokenShares)
  totalEarnedAssets = totalEarnedAssets.minus(
    getAnnualReward(mintedOsTokenAssets, getVaultOsTokenMintApy(osToken, osTokenConfig, useDayApy)),
  )

  const boostPosition = loadLeverageStrategyPosition(vaultAddress, allocatorAddress)
  if (boostPosition !== null) {
    const aave = loadAave()!
    totalEarnedAssets = totalEarnedAssets.plus(
      getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, boostPosition, distributor, useDayApy),
    )
    let extraOsTokenShares: BigInt
    let mintedLockedOsTokenShares: BigInt
    if (boostPosition.osTokenShares.gt(allocator.mintedOsTokenShares)) {
      extraOsTokenShares = boostPosition.osTokenShares.minus(allocator.mintedOsTokenShares)
      mintedLockedOsTokenShares = allocator.mintedOsTokenShares
    } else {
      extraOsTokenShares = BigInt.zero()
      mintedLockedOsTokenShares = boostPosition.osTokenShares
    }
    const mintedLockedOsTokenAssets = convertOsTokenSharesToAssets(osToken, mintedLockedOsTokenShares)
    totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(mintedLockedOsTokenAssets, osTokenApy))
    principalAssets = principalAssets
      .plus(convertOsTokenSharesToAssets(osToken, extraOsTokenShares))
      .plus(boostPosition.assets)
  }

  if (principalAssets.isZero()) {
    return BigDecimal.zero()
  }

  const allocatorApy = totalEarnedAssets.divDecimal(principalAssets.toBigDecimal()).times(BigDecimal.fromString('100'))
  if (allocatorApy.gt(vault.allocatorMaxBoostApy)) {
    return vault.allocatorMaxBoostApy
  }
}

export function getAllocatorTotalAssets(osToken: OsToken, allocator: Allocator): BigInt {
  let totalAssets = allocator.assets

  // get assets from the exit requests
  let exitRequest: ExitRequest
  const exitRequests: Array<ExitRequest> = allocator.exitRequests.load()
  for (let i = 0; i < exitRequests.length; i++) {
    exitRequest = exitRequests[i]
    if (
      !exitRequest.isClaimed &&
      Address.fromBytes(exitRequest.receiver).equals(Address.fromBytes(allocator.address))
    ) {
      totalAssets = totalAssets.plus(exitRequest.totalAssets)
    }
  }

  // get assets from the leverage strategy position
  const vaultAddress = Address.fromString(allocator.vault)
  const allocatorAddress = Address.fromBytes(allocator.address)
  const boostPosition = loadLeverageStrategyPosition(vaultAddress, allocatorAddress)
  if (boostPosition !== null) {
    if (boostPosition.osTokenShares.gt(allocator.mintedOsTokenShares)) {
      totalAssets = totalAssets.plus(
        convertOsTokenSharesToAssets(osToken, boostPosition.osTokenShares.minus(allocator.mintedOsTokenShares)),
      )
    }
    totalAssets = totalAssets.plus(boostPosition.assets)
  }

  return totalAssets
}

export function updateAllocatorAssets(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  allocator: Allocator,
): BigInt {
  const assetsBefore = allocator.assets
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.save()
  return allocator.assets.minus(assetsBefore)
}

export function updateAllocatorsLtvStatus(): void {
  const network = loadNetwork()!
  let vault: Vault | null
  let vaultAddress: Address
  let osTokenConfig: OsTokenConfig
  let allocators: Array<Allocator>
  const vaultIds = network.vaultIds
  for (let i = 0; i < vaultIds.length; i++) {
    vaultAddress = Address.fromString(vaultIds[i])
    vault = loadVault(vaultAddress)
    if (!vault) {
      log.error('[updateAllocatorsLtvStatus] vault={} not found', [vaultAddress.toHex()])
      continue
    }
    osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
    allocators = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      const allocator = allocators[j]
      allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
      allocator.save()
    }
  }
}

export function updateAllocatorMintedOsTokenShares(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  allocator: Allocator,
  newMintedOsTokenShares: BigInt,
): BigInt {
  const mintedOsTokenSharesDiff = newMintedOsTokenShares.minus(allocator.mintedOsTokenShares)
  if (osTokenConfig.ltvPercent.isZero()) {
    log.error('[Allocator] ltvPercent cannot be zero for vault={}', [allocator.vault])
    return convertOsTokenSharesToAssets(osToken, mintedOsTokenSharesDiff)
  }

  const mintedOsTokenAssetsDiff = convertOsTokenSharesToAssets(osToken, mintedOsTokenSharesDiff)
    .times(BigInt.fromString(WAD))
    .div(osTokenConfig.ltvPercent)

  allocator.mintedOsTokenShares = newMintedOsTokenShares
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator.save()

  return mintedOsTokenAssetsDiff
}

export function snapshotAllocator(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  distributor: Distributor,
  allocator: Allocator,
  earnedAssets: BigInt,
  timestamp: BigInt,
): void {
  const allocatorSnapshot = new AllocatorSnapshot(timestamp.toString())
  allocatorSnapshot.timestamp = timestamp.toI64()
  allocatorSnapshot.allocator = allocator.id
  allocatorSnapshot.earnedAssets = earnedAssets
  allocatorSnapshot.totalAssets = getAllocatorTotalAssets(osToken, allocator)
  allocatorSnapshot.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocator, true)
  allocatorSnapshot.ltv = allocator.ltv
  allocatorSnapshot.save()
}

function _getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}
