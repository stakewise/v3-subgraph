import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { Allocator, AllocatorAction, AllocatorSnapshot, OsToken, OsTokenConfig, Vault } from '../../generated/schema'
import { Vault as VaultContract } from '../../generated/Keeper/Vault'
import { WAD } from '../helpers/constants'
import { convertOsTokenSharesToAssets } from './osToken'
import { createOrLoadNetwork } from './network'
import { createOrLoadOsTokenConfig } from './osTokenConfig'

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
    vaultAllocator.osTokenMintApy = BigDecimal.zero()
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

export function getAllocatorOsTokenMintApy(
  allocator: Allocator,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
): BigDecimal {
  if (allocator.assets.isZero() || osTokenConfig.ltvPercent.isZero()) {
    return BigDecimal.zero()
  }
  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, allocator.mintedOsTokenShares)
  if (mintedOsTokenAssets.isZero()) {
    return BigDecimal.zero()
  }

  const feePercent = new BigDecimal(BigInt.fromI32(osToken.feePercent))
  const maxPercent = new BigDecimal(BigInt.fromI32(10000))
  const maxOsTokenMintApy = osToken.apy
    .times(feePercent)
    .times(BigDecimal.fromString(WAD))
    .div(maxPercent.minus(feePercent))
    .div(new BigDecimal(osTokenConfig.ltvPercent))
  const maxMintedOsTokenAssets = allocator.assets.times(osTokenConfig.ltvPercent).div(BigInt.fromString(WAD))
  if (mintedOsTokenAssets.ge(maxMintedOsTokenAssets)) {
    return maxOsTokenMintApy
  }
  return maxOsTokenMintApy.times(new BigDecimal(mintedOsTokenAssets)).div(new BigDecimal(maxMintedOsTokenAssets))
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

export function snapshotAllocator(
  allocator: Allocator,
  osToken: OsToken,
  osTokenConfig: OsTokenConfig,
  assetsDiff: BigInt,
  osTokenMintedSharesDiff: BigInt,
  rewardsTimestamp: BigInt,
): void {
  let osTokenAssetsDiff: BigInt
  if (osTokenConfig.ltvPercent.isZero()) {
    osTokenAssetsDiff = BigInt.zero()
  } else {
    osTokenAssetsDiff = convertOsTokenSharesToAssets(osToken, osTokenMintedSharesDiff)
      .times(BigInt.fromString(WAD))
      .div(osTokenConfig.ltvPercent)
  }

  const allocatorSnapshot = new AllocatorSnapshot(rewardsTimestamp.toString())
  allocatorSnapshot.timestamp = rewardsTimestamp.toI64()
  allocatorSnapshot.allocator = allocator.id
  allocatorSnapshot.earnedAssets = assetsDiff.minus(osTokenAssetsDiff)
  allocatorSnapshot.totalAssets = allocator.assets
  allocatorSnapshot.ltv = allocator.ltv
  allocatorSnapshot.save()
}

function _getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}
