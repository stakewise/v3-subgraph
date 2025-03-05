import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  AllocatorAction,
  AllocatorSnapshot,
  Distributor,
  OsToken,
  OsTokenConfig,
  RewardSplitter,
  Vault,
} from '../../generated/schema'
import { WAD } from '../helpers/constants'
import { calculateApy, chunkedVaultMulticall, getAnnualReward } from '../helpers/utils'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, getOsTokenApy } from './osToken'
import { convertSharesToAssets, getVaultApy, getVaultOsTokenMintApy, loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { getBoostPositionAnnualReward, loadLeverageStrategyPosition } from './leverageStrategy'
import { loadNetwork } from './network'
import { loadAave } from './aave'
import { loadRewardSplitterShareHolder } from './rewardSplitter'

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
    vaultAllocator.totalEarnedAssets = BigInt.zero()
    vaultAllocator._periodEarnedAssets = BigInt.zero()
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

export function updateAllocatorsMintedOsTokenShares(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
): void {
  // Prepare all calls for retrieving minted shares from OsToken positions
  let calls: Array<Bytes> = []
  let allocator: Allocator
  const allocatorsWithMintedOsTokenShares: Array<Allocator> = []
  const allocators: Array<Allocator> = vault.allocators.load()
  for (let i = 0; i < allocators.length; i++) {
    allocator = allocators[i]
    if (allocator.mintedOsTokenShares.gt(BigInt.zero())) {
      allocatorsWithMintedOsTokenShares.push(allocator)
      calls.push(_getOsTokenPositionsCall(allocator))
    }
  }

  // Execute calls in chunks of size 100
  let response = chunkedVaultMulticall(Address.fromString(vault.id), null, calls, 100)

  // Decode the result for each allocator in the same order
  for (let i = 0; i < response.length; i++) {
    updateAllocatorMintedOsTokenShares(
      osToken,
      osTokenConfig,
      allocatorsWithMintedOsTokenShares[i],
      ethereum.decode('uint256', response[i])!.toBigInt(),
    )
  }
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
): BigDecimal {
  const vaultAddress = Address.fromString(allocator.vault)
  const allocatorAddress = Address.fromBytes(allocator.address)

  const vaultApy = getVaultApy(vault, distributor, osToken, false)
  const osTokenApy = getOsTokenApy(osToken, false)

  let totalAssets = allocator.assets
  let totalEarnedAssets = getAnnualReward(totalAssets, vaultApy)

  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, allocator.mintedOsTokenShares)
  totalEarnedAssets = totalEarnedAssets.minus(
    getAnnualReward(mintedOsTokenAssets, getVaultOsTokenMintApy(osToken, osTokenConfig)),
  )

  const boostPosition = loadLeverageStrategyPosition(vaultAddress, allocatorAddress)
  if (boostPosition !== null) {
    const aave = loadAave()!
    totalEarnedAssets = totalEarnedAssets.plus(
      getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, boostPosition, distributor),
    )
    const boostedOsTokenShares = boostPosition.osTokenShares
      .plus(boostPosition.exitingOsTokenShares)
      .plus(convertAssetsToOsTokenShares(osToken, boostPosition.assets.plus(boostPosition.exitingAssets)))
    let extraOsTokenShares: BigInt
    let mintedLockedOsTokenShares: BigInt
    if (boostedOsTokenShares.gt(allocator.mintedOsTokenShares)) {
      extraOsTokenShares = boostedOsTokenShares.minus(allocator.mintedOsTokenShares)
      mintedLockedOsTokenShares = allocator.mintedOsTokenShares
    } else {
      extraOsTokenShares = BigInt.zero()
      mintedLockedOsTokenShares = boostedOsTokenShares
    }
    const mintedLockedOsTokenAssets = convertOsTokenSharesToAssets(osToken, mintedLockedOsTokenShares)
    totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(mintedLockedOsTokenAssets, osTokenApy))
    totalAssets = totalAssets.plus(convertOsTokenSharesToAssets(osToken, extraOsTokenShares))
  }

  if (totalAssets.isZero()) {
    return BigDecimal.zero()
  }

  const allocatorApy = totalEarnedAssets.divDecimal(totalAssets.toBigDecimal()).times(BigDecimal.fromString('100'))
  if (vaultApy.lt(vault.allocatorMaxBoostApy) && allocatorApy.gt(vault.allocatorMaxBoostApy)) {
    log.warning(
      '[getAllocatorApy] Calculated APY is higher than max boost APY: maxBoostApy={} allocatorApy={} vault={} allocator={}',
      [vault.allocatorMaxBoostApy.toString(), allocatorApy.toString(), vault.id, allocator.address.toHex()],
    )
    return vault.allocatorMaxBoostApy
  }
  return allocatorApy
}

export function getAllocatorTotalAssets(osToken: OsToken, vault: Vault, allocator: Allocator): BigInt {
  let totalAssets = allocator.assets

  // get assets from the leverage strategy position
  const vaultAddress = Address.fromString(allocator.vault)
  const allocatorAddress = Address.fromBytes(allocator.address)
  const boostPosition = loadLeverageStrategyPosition(vaultAddress, allocatorAddress)
  if (boostPosition !== null) {
    const boostedOsTokenShares = boostPosition.osTokenShares
      .plus(boostPosition.exitingOsTokenShares)
      .plus(convertAssetsToOsTokenShares(osToken, boostPosition.assets.plus(boostPosition.exitingAssets)))
    if (boostedOsTokenShares.gt(allocator.mintedOsTokenShares)) {
      totalAssets = totalAssets.plus(
        convertOsTokenSharesToAssets(osToken, boostedOsTokenShares.minus(allocator.mintedOsTokenShares)),
      )
    }
  }

  // get assets from the reward splitter
  const rewardSplitters: Array<RewardSplitter> = vault.rewardSplitters.load()
  for (let i = 0; i < rewardSplitters.length; i++) {
    const rewardSplitterAddress = Address.fromString(rewardSplitters[i].id)
    const shareHolder = loadRewardSplitterShareHolder(allocatorAddress, rewardSplitterAddress)
    if (shareHolder) {
      totalAssets = totalAssets.plus(shareHolder.earnedVaultAssets)
    }
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
): void {
  const mintedOsTokenSharesDiff = newMintedOsTokenShares.minus(allocator.mintedOsTokenShares)
  if (osTokenConfig.ltvPercent.isZero() || mintedOsTokenSharesDiff.lt(BigInt.zero())) {
    log.error(
      '[Allocator] minted OsToken shares update failed for allocator={} osTokenConfig={} mintedOsTokenSharesDiff={}',
      [allocator.id, osTokenConfig.id, mintedOsTokenSharesDiff.toString()],
    )
    return
  }

  const mintedOsTokenAssetsDiff = convertOsTokenSharesToAssets(osToken, mintedOsTokenSharesDiff)
    .times(BigInt.fromString(WAD))
    .div(osTokenConfig.ltvPercent)

  allocator.mintedOsTokenShares = newMintedOsTokenShares
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  allocator._periodEarnedAssets = allocator._periodEarnedAssets.minus(mintedOsTokenAssetsDiff)
  allocator.save()
}

export function snapshotAllocator(
  osToken: OsToken,
  vault: Vault,
  allocator: Allocator,
  earnedAssets: BigInt,
  duration: BigInt,
  timestamp: BigInt,
): void {
  const totalAssets = getAllocatorTotalAssets(osToken, vault, allocator)
  const allocatorSnapshot = new AllocatorSnapshot(timestamp.toString())
  allocatorSnapshot.timestamp = timestamp.toI64()
  allocatorSnapshot.allocator = allocator.id
  allocatorSnapshot.earnedAssets = earnedAssets
  allocatorSnapshot.totalAssets = totalAssets
  allocatorSnapshot.apy = calculateApy(earnedAssets, totalAssets, duration)
  allocatorSnapshot.ltv = allocator.ltv
  allocatorSnapshot.save()
}

function _getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}
