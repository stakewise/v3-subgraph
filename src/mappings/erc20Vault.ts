import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/templates/Erc20Vault/Erc20Vault'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorApy,
  loadAllocator,
  snapshotAllocator,
  updateAllocatorAssets,
} from '../entities/allocator'
import { createTransaction } from '../entities/transaction'
import { decreaseUserVaultsCount, increaseUserVaultsCount } from '../entities/network'
import { convertSharesToAssets, loadVault } from '../entities/vault'
import { loadOsToken } from '../entities/osToken'
import { loadOsTokenConfig } from '../entities/osTokenConfig'

// Event emitted on mint, burn or transfer shares between allocators
export function handleTransfer(event: Transfer): void {
  const params = event.params
  const vaultAddress = event.address
  const timestamp = event.block.timestamp
  const vault = loadVault(vaultAddress)!
  const osToken = loadOsToken()!
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!

  const from = params.from
  const to = params.to
  const shares = params.value
  const assets = convertSharesToAssets(vault, shares)

  const zeroAddress = Address.zero()
  if (from.equals(zeroAddress) || to.equals(zeroAddress)) {
    // mint and burn are handled in handleDeposited, handleRedeemed mappings
    return
  }

  const allocatorFrom = loadAllocator(from, vaultAddress)!
  allocatorFrom.shares = allocatorFrom.shares.minus(shares)
  updateAllocatorAssets(osToken, osTokenConfig, vault, allocatorFrom)
  allocatorFrom.apy = getAllocatorApy(osToken, osTokenConfig, vault, allocatorFrom, false)
  allocatorFrom.save()
  snapshotAllocator(osToken, osTokenConfig, vault, allocatorFrom, BigInt.zero(), timestamp)
  if (allocatorFrom.shares.isZero()) {
    decreaseUserVaultsCount(allocatorFrom.address)
  }
  createAllocatorAction(event, vaultAddress, AllocatorActionType.TransferOut, from, assets, shares)

  const allocatorTo = createOrLoadAllocator(to, vaultAddress)
  if (allocatorTo.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(allocatorTo.address)
  }
  allocatorTo.shares = allocatorTo.shares.plus(shares)
  updateAllocatorAssets(osToken, osTokenConfig, vault, allocatorTo)
  allocatorTo.apy = getAllocatorApy(osToken, osTokenConfig, vault, allocatorTo, false)
  allocatorTo.save()
  snapshotAllocator(osToken, osTokenConfig, vault, allocatorTo, BigInt.zero(), timestamp)
  createAllocatorAction(event, vaultAddress, AllocatorActionType.TransferIn, to, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Transfer vault={} from={} to={} shares={} assets={}', [
    vaultAddress.toHex(),
    from.toHex(),
    to.toHex(),
    shares.toString(),
    assets.toString(),
  ])
}
