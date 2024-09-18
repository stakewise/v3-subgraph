import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { Allocator, AllocatorAction, AllocatorSnapshot, OsToken, OsTokenConfig, Vault } from '../../generated/schema'
import { Vault as VaultContract } from '../../generated/Keeper/Vault'
import { WAD } from '../helpers/constants'
import { convertOsTokenSharesToAssets, getOsTokenLastApy } from './osToken'
import { getVaultLastApy } from './vaults'

const osTokenPositionsSelector = '0x4ec96b22'

export function createOrLoadAllocator(allocatorAddress: Address, vaultAddress: Address): Allocator {
  const vaultAllocatorAddress = `${vaultAddress.toHex()}-${allocatorAddress.toHex()}`

  let vaultAllocator = Allocator.load(vaultAllocatorAddress)

  if (vaultAllocator === null) {
    vaultAllocator = new Allocator(vaultAllocatorAddress)
    vaultAllocator.shares = BigInt.zero()
    vaultAllocator.assets = BigInt.zero()
    vaultAllocator.mintedOsTokenShares = BigInt.zero()
    vaultAllocator.ltv = BigDecimal.zero()
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
  actionType: string,
  owner: Address,
  assets: BigInt | null,
  shares: BigInt | null,
): void {
  if (assets === null && shares === null) {
    log.error('[AllocatorAction] Both assets and shares cannot be null for action={}', [actionType])
    return
  }
  const txHash = event.transaction.hash.toHex()
  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)
  allocatorAction.vault = vaultAddress.toHex()
  allocatorAction.address = owner
  allocatorAction.actionType = actionType
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()
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
  osTokenApy: BigDecimal,
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
  const maxOsTokenMintApy = osTokenApy
    .times(feePercent)
    .times(BigDecimal.fromString(WAD))
    .div(maxPercent.minus(feePercent))
    .div(new BigDecimal(osTokenConfig.ltvPercent))
  return maxOsTokenMintApy.times(new BigDecimal(mintedOsTokenAssets)).div(new BigDecimal(allocator.assets))
}

export function snapshotAllocator(
  allocator: Allocator,
  vault: Vault,
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

  const vaultApy = getVaultLastApy(vault)
  const osTokenMintApy = getAllocatorOsTokenMintApy(allocator, getOsTokenLastApy(osToken), osToken, osTokenConfig)

  const allocatorSnapshot = new AllocatorSnapshot('1')
  allocatorSnapshot.timestamp = rewardsTimestamp.toI64()
  allocatorSnapshot.allocator = allocator.id
  allocatorSnapshot.earnedAssets = assetsDiff.minus(osTokenAssetsDiff)
  allocatorSnapshot.ltv = allocator.ltv
  allocatorSnapshot.apy = vaultApy.minus(osTokenMintApy)
  allocatorSnapshot.save()
}

function _getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}
