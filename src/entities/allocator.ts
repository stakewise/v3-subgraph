import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Aave,
  Allocator,
  AllocatorAction,
  AllocatorSnapshot,
  OsToken,
  OsTokenConfig,
  OsTokenExitRequest,
  Vault,
} from '../../generated/schema'
import { WAD } from '../helpers/constants'
import {
  calculateApy,
  chunkedMulticall,
  encodeContractCall,
  getAnnualReward,
  getSnapshotTimestamp,
} from '../helpers/utils'
import { convertOsTokenSharesToAssets, loadOsTokenHolder } from './osToken'
import { convertSharesToAssets, getVaultOsTokenMintApy, loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { loadLeverageStrategyPosition } from './leverageStrategy'
import { decreaseUserVaultsCount, increaseUserVaultsCount, loadNetwork } from './network'
import { loadAavePosition } from './aave'

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
  BoostExitQueueEntered,
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
  'BoostExitQueueEntered',
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
    vaultAllocator.totalAssets = BigInt.zero()
    vaultAllocator.mintedOsTokenShares = BigInt.zero()
    vaultAllocator.exitingAssets = BigInt.zero()
    vaultAllocator.stakingExitingAssets = BigInt.zero()
    vaultAllocator.ltv = BigDecimal.zero()
    vaultAllocator.ltvStatus = LtvStatusStrings[LtvStatus.Healthy]
    vaultAllocator.address = allocatorAddress
    vaultAllocator.vault = vaultAddress.toHex()
    vaultAllocator.apy = BigDecimal.zero()
    vaultAllocator.totalEarnedAssets = BigInt.zero()
    vaultAllocator.totalStakeEarnedAssets = BigInt.zero()
    vaultAllocator.totalBoostEarnedAssets = BigInt.zero()
    vaultAllocator.totalExtraEarnedAssets = BigInt.zero()
    vaultAllocator._periodStakeEarnedAssets = BigInt.zero()
    vaultAllocator._periodBoostEarnedAssets = BigInt.zero()
    vaultAllocator._periodBoostEarnedOsTokenShares = BigInt.zero()
    vaultAllocator._periodOsTokenFeeShares = BigInt.zero()
    vaultAllocator._periodExtraEarnedAssets = BigInt.zero()
    vaultAllocator.save()
  }

  return vaultAllocator
}

export function createAllocatorSnapshot(
  osToken: OsToken,
  allocator: Allocator,
  rewardSplitterAssets: BigInt,
  duration: BigInt,
  timestamp: i64,
): AllocatorSnapshot {
  // calculate allocator total assets
  const snapshotTimestamp = getSnapshotTimestamp(timestamp)
  const snapshotId = Bytes.fromHexString(allocator.vault)
    .concat(allocator.address)
    .concat(Bytes.fromByteArray(Bytes.fromI64(snapshotTimestamp)))

  const allocatorSnapshot = new AllocatorSnapshot(snapshotId)
  allocatorSnapshot.timestamp = snapshotTimestamp
  allocatorSnapshot.allocator = allocator.id
  allocatorSnapshot.stakeEarnedAssets = allocator._periodStakeEarnedAssets.minus(
    convertOsTokenSharesToAssets(osToken, allocator._periodOsTokenFeeShares),
  )
  allocatorSnapshot.boostEarnedAssets = allocator._periodBoostEarnedAssets.plus(
    convertOsTokenSharesToAssets(osToken, allocator._periodBoostEarnedOsTokenShares),
  )
  allocatorSnapshot.extraEarnedAssets = allocator._periodExtraEarnedAssets

  const stakeAndBoostEarnedAssets = allocatorSnapshot.stakeEarnedAssets.plus(allocatorSnapshot.boostEarnedAssets)
  allocatorSnapshot.earnedAssets = stakeAndBoostEarnedAssets.plus(allocatorSnapshot.extraEarnedAssets)
  allocatorSnapshot.totalAssets = allocator.totalAssets.plus(rewardSplitterAssets)
  allocatorSnapshot.apy = calculateApy(
    stakeAndBoostEarnedAssets,
    allocator.totalAssets.minus(stakeAndBoostEarnedAssets),
    duration,
  )
  allocatorSnapshot.ltv = allocator.ltv
  allocatorSnapshot.save()

  allocator.totalEarnedAssets = allocator.totalEarnedAssets.plus(allocatorSnapshot.earnedAssets)
  allocator.totalStakeEarnedAssets = allocator.totalStakeEarnedAssets.plus(allocatorSnapshot.stakeEarnedAssets)
  allocator.totalBoostEarnedAssets = allocator.totalBoostEarnedAssets.plus(allocatorSnapshot.boostEarnedAssets)
  allocator.totalExtraEarnedAssets = allocator.totalExtraEarnedAssets.plus(allocatorSnapshot.extraEarnedAssets)
  allocator._periodBoostEarnedAssets = BigInt.zero()
  allocator._periodBoostEarnedOsTokenShares = BigInt.zero()
  allocator._periodStakeEarnedAssets = BigInt.zero()
  allocator._periodOsTokenFeeShares = BigInt.zero()
  allocator._periodExtraEarnedAssets = BigInt.zero()
  allocator.save()

  return allocatorSnapshot
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
  const allocatorAction = new AllocatorAction(`${txHash}-${event.logIndex.toString()}`)
  allocatorAction.hash = event.transaction.hash
  allocatorAction.vault = vaultAddress.toHex()
  allocatorAction.address = owner
  allocatorAction.actionType = allocatorActionString
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()
}

export function updateAllocatorMintedOsTokenShares(osToken: OsToken, osTokenConfig: OsTokenConfig, vault: Vault): void {
  if (!vault.isOsTokenEnabled) {
    return
  }

  // Prepare all calls for retrieving minted shares from OsToken positions
  let calls: Array<ethereum.Value> = []
  let allocator: Allocator
  const allocatorsToUpdate: Array<Allocator> = []
  const allocators: Array<Allocator> = vault.allocators.load()
  const vaultAddress = Address.fromString(vault.id)
  for (let i = 0; i < allocators.length; i++) {
    allocator = allocators[i]
    if (allocator.shares.gt(BigInt.zero())) {
      allocatorsToUpdate.push(allocator)
      calls.push(encodeContractCall(vaultAddress, _getOsTokenPositionsCall(allocator)))
    }
  }

  // Execute calls in chunks of size 100
  let response = chunkedMulticall(null, calls, true, 100)

  let mintedOsTokenSharesDiff: BigInt
  let allocatorNewMintedOsTokenShares: BigInt
  for (let i = 0; i < response.length; i++) {
    allocator = allocatorsToUpdate[i]
    allocatorNewMintedOsTokenShares = ethereum.decode('uint256', response[i]!)!.toBigInt()

    mintedOsTokenSharesDiff = allocatorNewMintedOsTokenShares.minus(allocator.mintedOsTokenShares)
    if (mintedOsTokenSharesDiff.lt(BigInt.zero())) {
      log.error(
        '[Allocator] minted OsToken shares update failed for allocator={} osTokenConfig={} mintedOsTokenSharesDiff={}',
        [allocator.id, osTokenConfig.id, mintedOsTokenSharesDiff.toString()],
      )
      return
    }

    allocator.mintedOsTokenShares = allocatorNewMintedOsTokenShares
    allocator.ltv = getAllocatorLtv(allocator, osToken)
    allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
    allocator._periodOsTokenFeeShares = allocator._periodOsTokenFeeShares.plus(mintedOsTokenSharesDiff)
    allocator.save()
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
  aave: Aave,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  allocator: Allocator,
  isMainVaultStaker: boolean,
): BigDecimal {
  const vaultAddress = Address.fromString(allocator.vault)
  const allocatorAddress = Address.fromBytes(allocator.address)

  let stakingAssets = allocator.assets.plus(allocator.stakingExitingAssets)
  let exitedAssets = allocator.exitingAssets.minus(allocator.stakingExitingAssets)
  let mintedOsTokenShares = allocator.mintedOsTokenShares

  let osTokenSharesBalance = BigInt.zero()
  if (isMainVaultStaker) {
    const osTokenHolder = loadOsTokenHolder(Address.fromBytes(allocator.address))
    if (osTokenHolder !== null) {
      osTokenSharesBalance = osTokenHolder.balance
    }
  }

  let borrowedAssets = BigInt.zero()
  if (vault.isOsTokenEnabled) {
    const boostPosition = loadLeverageStrategyPosition(vaultAddress, allocatorAddress)
    if (boostPosition !== null) {
      const proxyAddress = Address.fromBytes(boostPosition.proxy)
      const boostAavePosition = loadAavePosition(proxyAddress)!
      const boostAllocator = loadAllocator(proxyAddress, vaultAddress)!

      osTokenSharesBalance = osTokenSharesBalance.plus(boostAavePosition.suppliedOsTokenShares)
      borrowedAssets = borrowedAssets.plus(boostAavePosition.borrowedAssets)

      stakingAssets = stakingAssets.plus(boostAllocator.assets).plus(boostAllocator.stakingExitingAssets)
      exitedAssets = exitedAssets.plus(boostAllocator.exitingAssets).minus(boostAllocator.stakingExitingAssets)
      mintedOsTokenShares = mintedOsTokenShares.plus(boostAllocator.mintedOsTokenShares)

      // Handle osToken shares from active leverage exit request
      if (boostPosition.exitRequest !== null) {
        const osTokenExitRequest = OsTokenExitRequest.load(boostPosition.exitRequest!)!
        mintedOsTokenShares = mintedOsTokenShares.plus(osTokenExitRequest.osTokenShares)
        if (osTokenExitRequest.exitedAssets !== null) {
          exitedAssets = exitedAssets.plus(osTokenExitRequest.exitedAssets!)
        }
      }
    }
  }

  const allocatorApy = calcAllocatorApy(
    aave,
    osToken,
    vault,
    osTokenConfig,
    stakingAssets,
    exitedAssets,
    mintedOsTokenShares,
    osTokenSharesBalance,
    borrowedAssets,
  )

  if (vault.apy.lt(vault.allocatorMaxBoostApy) && allocatorApy.gt(vault.allocatorMaxBoostApy)) {
    log.warning(
      '[getAllocatorApy] Calculated APY is higher than max boost APY: maxBoostApy={} allocatorApy={} vault={} allocator={}',
      [vault.allocatorMaxBoostApy.toString(), allocatorApy.toString(), vault.id, allocator.address.toHex()],
    )
    return vault.allocatorMaxBoostApy
  }
  return allocatorApy
}

export function getAllocatorAssets(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  allocator: Allocator,
  isMainVaultStaker: boolean,
): BigInt {
  const vaultAddress = Address.fromString(allocator.vault)
  const allocatorAddress = Address.fromBytes(allocator.address)

  let stakingAssets = allocator.assets
  let exitingAssets = allocator.exitingAssets
  let mintedOsTokenShares = allocator.mintedOsTokenShares

  let osTokenSharesBalance = BigInt.zero()
  if (isMainVaultStaker) {
    const osTokenHolder = loadOsTokenHolder(Address.fromBytes(allocator.address))
    if (osTokenHolder !== null) {
      osTokenSharesBalance = osTokenHolder.balance
    }
  }

  let borrowedAssets = BigInt.zero()
  const boostPosition = loadLeverageStrategyPosition(vaultAddress, allocatorAddress)
  if (boostPosition !== null) {
    const proxyAddress = Address.fromBytes(boostPosition.proxy)
    const boostAavePosition = loadAavePosition(proxyAddress)!
    const boostAllocator = loadAllocator(proxyAddress, vaultAddress)!

    osTokenSharesBalance = osTokenSharesBalance.plus(boostAavePosition.suppliedOsTokenShares)
    borrowedAssets = borrowedAssets.plus(boostAavePosition.borrowedAssets)

    stakingAssets = stakingAssets.plus(boostAllocator.assets)
    exitingAssets = exitingAssets.plus(boostAllocator.exitingAssets)
    mintedOsTokenShares = mintedOsTokenShares.plus(boostAllocator.mintedOsTokenShares)

    // Handle osToken shares from active leverage exit request
    if (boostPosition.exitRequest !== null) {
      const osTokenExitRequest = OsTokenExitRequest.load(boostPosition.exitRequest!)!
      mintedOsTokenShares = mintedOsTokenShares.plus(osTokenExitRequest.osTokenShares)
      if (osTokenExitRequest.exitedAssets !== null) {
        exitingAssets = exitingAssets.plus(osTokenExitRequest.exitedAssets!)
      }
    }
  }

  if (isMainVaultStaker) {
    return calcStakerAssets(
      osToken,
      stakingAssets,
      exitingAssets,
      mintedOsTokenShares,
      osTokenSharesBalance,
      borrowedAssets,
      osTokenConfig,
    )
  }

  return calcAllocatorAssets(
    osToken,
    stakingAssets,
    exitingAssets,
    mintedOsTokenShares,
    osTokenSharesBalance,
    borrowedAssets,
  )
}

export function increaseAllocatorShares(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  allocator: Allocator,
  shares: BigInt,
): void {
  syncAllocatorPeriodStakeEarnedAssets(vault, allocator)

  if (allocator.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(allocator.address)
  }
  allocator.shares = allocator.shares.plus(shares)
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  if (vault.isOsTokenEnabled) {
    allocator.ltv = getAllocatorLtv(allocator, osToken)
    allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  }
}

export function decreaseAllocatorShares(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  vault: Vault,
  allocator: Allocator,
  shares: BigInt,
): void {
  syncAllocatorPeriodStakeEarnedAssets(vault, allocator)

  allocator.shares = allocator.shares.minus(shares)
  if (allocator.shares.le(BigInt.zero())) {
    decreaseUserVaultsCount(allocator.address)
  }
  allocator.assets = convertSharesToAssets(vault, allocator.shares)
  if (vault.isOsTokenEnabled) {
    allocator.ltv = getAllocatorLtv(allocator, osToken)
    allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
  }
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

export function syncAllocatorPeriodStakeEarnedAssets(vault: Vault, allocator: Allocator): void {
  const assetsBefore = allocator.assets
  const assetsAfter = convertSharesToAssets(vault, allocator.shares)
  allocator._periodStakeEarnedAssets = allocator._periodStakeEarnedAssets.plus(assetsAfter.minus(assetsBefore))
}

export function increaseAllocatorMintedOsTokenShares(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  allocator: Allocator,
  shares: BigInt,
): void {
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.plus(shares)
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
}

export function decreaseAllocatorMintedOsTokenShares(
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  allocator: Allocator,
  shares: BigInt,
): void {
  allocator.mintedOsTokenShares = allocator.mintedOsTokenShares.minus(shares)
  if (allocator.mintedOsTokenShares.lt(BigInt.zero())) {
    allocator.mintedOsTokenShares = BigInt.zero()
  }
  allocator.ltv = getAllocatorLtv(allocator, osToken)
  allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
}

export function calcAllocatorApy(
  aave: Aave,
  osToken: OsToken,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  stakingAssets: BigInt,
  exitedAssets: BigInt,
  mintedOsTokenShares: BigInt,
  osTokenSharesBalance: BigInt,
  borrowedAssets: BigInt,
): BigDecimal {
  let totalEarnedAssets = BigInt.zero()
  let totalAssets = stakingAssets.plus(exitedAssets)

  // staking assets earn vault APY
  if (stakingAssets.gt(BigInt.zero())) {
    totalEarnedAssets = totalEarnedAssets.plus(getAnnualReward(stakingAssets, vault.apy))
  }

  // minted osToken shares lose mint APY
  if (mintedOsTokenShares.gt(BigInt.zero())) {
    const osTokenMintApy = getVaultOsTokenMintApy(osToken, osTokenConfig)
    const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, mintedOsTokenShares)
    totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(mintedOsTokenAssets, osTokenMintApy))
  }

  // borrowed assets lose borrow APY
  if (borrowedAssets.gt(BigInt.zero())) {
    totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(borrowedAssets, aave.borrowApy))
    totalAssets = totalAssets.minus(borrowedAssets)
  }

  if (osTokenSharesBalance.gt(mintedOsTokenShares)) {
    // unminted osToken shares earn osToken APY
    const unmintedOsTokenShares = osTokenSharesBalance.minus(mintedOsTokenShares)
    const unmintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, unmintedOsTokenShares)
    totalEarnedAssets = totalEarnedAssets.plus(getAnnualReward(unmintedOsTokenAssets, osToken.apy))
    totalAssets = totalAssets.plus(unmintedOsTokenAssets)
  }

  if (totalAssets.isZero()) {
    return BigDecimal.zero()
  }

  return totalEarnedAssets.divDecimal(totalAssets.toBigDecimal()).times(BigDecimal.fromString('100'))
}

export function calcAllocatorAssets(
  osToken: OsToken,
  stakingAssets: BigInt,
  exitingAssets: BigInt,
  mintedOsTokenShares: BigInt,
  osTokenSharesBalance: BigInt,
  borrowedAssets: BigInt,
): BigInt {
  let totalAssets = stakingAssets.plus(exitingAssets).minus(borrowedAssets)

  if (osTokenSharesBalance.gt(mintedOsTokenShares)) {
    const excessOsTokenShares = osTokenSharesBalance.minus(mintedOsTokenShares)
    const excessOsTokenAssets = convertOsTokenSharesToAssets(osToken, excessOsTokenShares)
    totalAssets = totalAssets.plus(excessOsTokenAssets)
  }
  return totalAssets.gt(BigInt.zero()) ? totalAssets : BigInt.zero()
}

function _getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}

export function calcStakerAssets(
  osToken: OsToken,
  stakingAssets: BigInt,
  exitingAssets: BigInt,
  mintedOsTokenShares: BigInt,
  osTokenSharesBalance: BigInt,
  borrowedAssets: BigInt,
  osTokenConfig: OsTokenConfig,
): BigInt {
  if (osTokenSharesBalance.gt(mintedOsTokenShares)) {
    osTokenSharesBalance = osTokenSharesBalance.minus(mintedOsTokenShares)
    mintedOsTokenShares = BigInt.zero()
  } else {
    mintedOsTokenShares = mintedOsTokenShares.minus(osTokenSharesBalance)
    osTokenSharesBalance = BigInt.zero()
  }

  if (mintedOsTokenShares.gt(BigInt.zero())) {
    const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, mintedOsTokenShares)
    const lockedAssets = mintedOsTokenAssets.times(BigInt.fromString(WAD)).div(osTokenConfig.ltvPercent)
    stakingAssets = stakingAssets.gt(lockedAssets) ? stakingAssets.minus(lockedAssets) : BigInt.zero()
  }

  let totalAssets = stakingAssets.plus(exitingAssets).minus(borrowedAssets)
  if (osTokenSharesBalance.gt(BigInt.zero())) {
    const excessOsTokenAssets = convertOsTokenSharesToAssets(osToken, osTokenSharesBalance)
    totalAssets = totalAssets.plus(excessOsTokenAssets)
  }

  return totalAssets.gt(BigInt.zero()) ? totalAssets : BigInt.zero()
}
