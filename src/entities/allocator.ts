import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { Allocator, AllocatorAction, OsToken } from '../../generated/schema'
import { Vault as VaultContract } from '../../generated/BlockHandlers/Vault'

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
    vaultAllocator.save()
  }

  return vaultAllocator
}

export function createAllocatorAction(
  event: ethereum.Event,
  vaultAddress: Address,
  actionType: string,
  owner: Address,
  assets: BigInt,
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

export function updateAllocatorMintedOsTokenShares(allocator: Allocator): void {
  const vaultAddress = Address.fromString(allocator.vault)
  const vaultContract = VaultContract.bind(vaultAddress)

  // fetch minted osToken shares for allocator
  allocator.mintedOsTokenShares = vaultContract.osTokenPositions(Address.fromBytes(allocator.address))
}

export function updateAllocatorLtv(allocator: Allocator, osToken: OsToken): void {
  // calculate LTV
  if (allocator.assets.notEqual(BigInt.zero()) && osToken.totalSupply.notEqual(BigInt.zero())) {
    const mintedOsTokenAssets = allocator.mintedOsTokenShares.times(osToken.totalAssets).div(osToken.totalSupply)
    allocator.ltv = BigDecimal.fromString(mintedOsTokenAssets.toString()).div(
      BigDecimal.fromString(allocator.assets.toString()),
    )
  } else {
    allocator.ltv = BigDecimal.zero()
  }
}
