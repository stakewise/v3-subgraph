import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  AllocatorAction,
  AllocatorSnapshot,
  LeverageStrategyPosition,
  OsToken,
  OsTokenConfig,
  Vault,
} from '../../generated/schema'
import { Vault as VaultContract } from '../../generated/Keeper/Vault'
import { WAD } from '../helpers/constants'
import { convertOsTokenSharesToAssets } from './osToken'
import { createOrLoadNetwork } from './network'
import { createOrLoadOsTokenConfig } from './osTokenConfig'
import { createOrLoadSnapshotEarnedAssets } from './snapshot'

const osTokenPositionsSelector = '0x4ec96b22'

export enum LtvStatus {
  Healthy,
  Moderate,
  Risky,
  Unhealthy,
}

const LtvStatusStrings = ['Healthy', 'Moderate', 'Risky', 'Unhealthy']

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
}

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
]

export function createOrLoadAllocator(allocatorAddress: Address, vaultAddress: Address): Allocator {
  const vaultAllocatorAddress = `${vaultAddress.toHex()}-${allocatorAddress.toHex()}`

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

export function getAllocatorsMintedShares(vault: Vault, allocators: Allocator[]): Array<BigInt> {
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

export function getAllocatorLtv(allocator: Allocator, osToken: OsToken): BigDecimal {
  if (allocator.assets.isZero()) {
    return BigDecimal.zero()
  }
  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, allocator.mintedOsTokenShares)
  return new BigDecimal(mintedOsTokenAssets).div(new BigDecimal(allocator.assets))
}

export function getAllocatorApy(
  allocator: Allocator,
  vault: Vault,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
): BigDecimal {
  if (allocator.assets.isZero()) {
    // no assets, zero apy
    return BigDecimal.zero()
  }

  if (osTokenConfig.ltvPercent.isZero()) {
    // no osToken can be minted, return base APY
    return vault.apy
  }

  // calculate max APY that user can pay for minting osToken
  const feePercentBigDecimal = BigDecimal.fromString(osToken.feePercent.toString())
  const osTokenMaxMintApy = osToken.apy
    .times(feePercentBigDecimal)
    .times(BigDecimal.fromString(WAD))
    .div(BigDecimal.fromString('10000').minus(feePercentBigDecimal))
    .div(osTokenConfig.ltvPercent.toBigDecimal())

  // calculate max minted osToken assets based on the ltv percent
  const maxMintedOsTokenAssets = allocator.assets.times(osTokenConfig.ltvPercent).div(BigInt.fromString(WAD))

  let boostApy = BigDecimal.zero()
  const leverageStrategyPosition = LeverageStrategyPosition.load(`${vault.id}-${allocator.address.toHex()}`)
  if (leverageStrategyPosition !== null && maxMintedOsTokenAssets.gt(BigInt.zero())) {
    // calculate how much of the max minted osToken assets the user has boosted
    let stratOsTokenAssets = convertOsTokenSharesToAssets(osToken, leverageStrategyPosition.osTokenShares)
    if (stratOsTokenAssets.gt(maxMintedOsTokenAssets)) {
      stratOsTokenAssets = maxMintedOsTokenAssets
    }
    // calculate the boost apy based on the boosted osToken assets amount
    boostApy = vault.allocatorMaxBoostApy
      .minus(vault.apy)
      .plus(osTokenMaxMintApy)
      .times(new BigDecimal(stratOsTokenAssets))
      .div(new BigDecimal(maxMintedOsTokenAssets))
  }

  // convert minted osToken shares to assets
  let mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, allocator.mintedOsTokenShares)
  if (mintedOsTokenAssets.ge(maxMintedOsTokenAssets)) {
    mintedOsTokenAssets = maxMintedOsTokenAssets
  }

  let osTokenMintApy = BigDecimal.zero()
  if (mintedOsTokenAssets.gt(BigInt.zero()) && maxMintedOsTokenAssets.gt(BigInt.zero())) {
    // calculate the APY user is paying based on the minted osToken assets amount
    osTokenMintApy = osTokenMaxMintApy
      .times(mintedOsTokenAssets.toBigDecimal())
      .div(maxMintedOsTokenAssets.toBigDecimal())
  }

  return vault.apy.plus(boostApy).minus(osTokenMintApy)
}

export function updateAllocatorsLtvStatus(): void {
  const network = createOrLoadNetwork()
  let vault: Vault
  let osTokenConfig: OsTokenConfig
  let allocators: Array<Allocator>
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
    allocators = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      const allocator = allocators[j]
      allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
      allocator.save()
    }
  }
}

export function updateVaultAllocatorsApy(vault: Vault, osToken: OsToken, osTokenConfig: OsTokenConfig): void {
  const allocators: Array<Allocator> = vault.allocators.load()
  for (let i = 0; i < allocators.length; i++) {
    const allocator = allocators[i]
    allocator.apy = getAllocatorApy(allocator, vault, osToken, osTokenConfig)
    allocator.save()
  }
}

export function snapshotAllocator(
  allocator: Allocator,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  assetsDiff: BigInt,
  osTokenMintedSharesDiff: BigInt,
  rewardsTimestamp: BigInt,
): void {
  if (osTokenConfig.ltvPercent.gt(BigInt.zero())) {
    let osTokenAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenMintedSharesDiff)
      .times(BigInt.fromString(WAD))
      .div(osTokenConfig.ltvPercent)
    assetsDiff = assetsDiff.minus(osTokenAssetsDiff)
  }

  const snapshotEarnedAssets = createOrLoadSnapshotEarnedAssets('allocator', allocator.id, rewardsTimestamp)
  snapshotEarnedAssets.earnedAssets = snapshotEarnedAssets.earnedAssets.plus(assetsDiff)
  snapshotEarnedAssets.save()

  let apy = BigDecimal.zero()
  const principalAssets = allocator.assets.minus(snapshotEarnedAssets.earnedAssets)
  if (principalAssets.gt(BigInt.zero())) {
    apy = new BigDecimal(snapshotEarnedAssets.earnedAssets)
      .times(BigDecimal.fromString('365'))
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(principalAssets))
  }

  const allocatorSnapshot = new AllocatorSnapshot(rewardsTimestamp.toString())
  allocatorSnapshot.timestamp = rewardsTimestamp.toI64()
  allocatorSnapshot.allocator = allocator.id
  allocatorSnapshot.earnedAssets = assetsDiff
  allocatorSnapshot.totalAssets = allocator.assets
  allocatorSnapshot.apy = apy
  allocatorSnapshot.ltv = allocator.ltv
  allocatorSnapshot.save()
}

function _getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}
