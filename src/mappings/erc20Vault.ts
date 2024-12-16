import { BigInt, Address, log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/templates/Erc20Vault/Erc20Vault'
import { Vault } from '../../generated/schema'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorApy,
  getAllocatorLtv,
  getAllocatorLtvStatus,
  snapshotAllocator,
} from '../entities/allocator'
import { createTransaction } from '../entities/transaction'
import { convertSharesToAssets } from '../entities/vaults'
import { createOrLoadOsToken } from '../entities/osToken'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { decreaseUserVaultsCount, increaseUserVaultsCount } from '../entities/network'

// Event emitted on mint, burn or transfer shares between allocators
export function handleTransfer(event: Transfer): void {
  const params = event.params
  const vaultAddress = event.address
  const timestamp = event.block.timestamp
  const vault = Vault.load(vaultAddress.toHex()) as Vault
  const osToken = createOrLoadOsToken()
  const osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)

  const from = params.from
  const to = params.to
  const shares = params.value
  const assets = convertSharesToAssets(vault, shares)

  const zeroAddress = Address.zero()
  if (from.equals(zeroAddress) || to.equals(zeroAddress)) {
    // mint and burn are handled in handleDeposit, handleWithdraw mappings
    return
  }

  const allocatorFrom = createOrLoadAllocator(from, vaultAddress)
  allocatorFrom.shares = allocatorFrom.shares.minus(shares)
  allocatorFrom.assets = convertSharesToAssets(vault, allocatorFrom.shares)
  allocatorFrom.ltv = getAllocatorLtv(allocatorFrom, osToken)
  allocatorFrom.ltvStatus = getAllocatorLtvStatus(allocatorFrom, osTokenConfig)
  allocatorFrom.apy = getAllocatorApy(allocatorFrom, vault, osToken, osTokenConfig)
  allocatorFrom.save()
  if (allocatorFrom.shares.isZero()) {
    decreaseUserVaultsCount(allocatorFrom.address)
  }
  createAllocatorAction(event, vaultAddress, AllocatorActionType.TransferOut, from, assets, shares)
  snapshotAllocator(allocatorFrom, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  const allocatorTo = createOrLoadAllocator(to, vaultAddress)
  if (allocatorTo.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(allocatorTo.address)
  }
  allocatorTo.shares = allocatorTo.shares.plus(shares)
  allocatorTo.assets = convertSharesToAssets(vault, allocatorTo.shares)
  allocatorTo.ltv = getAllocatorLtv(allocatorTo, osToken)
  allocatorTo.ltvStatus = getAllocatorLtvStatus(allocatorTo, osTokenConfig)
  allocatorTo.apy = getAllocatorApy(allocatorTo, vault, osToken, osTokenConfig)
  allocatorTo.save()
  createAllocatorAction(event, vaultAddress, AllocatorActionType.TransferIn, to, assets, shares)
  snapshotAllocator(allocatorTo, osToken, osTokenConfig, BigInt.zero(), BigInt.zero(), timestamp)

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Transfer vault={} from={} to={} shares={} assets={}', [
    vaultAddress.toHex(),
    from.toHex(),
    to.toHex(),
    shares.toString(),
    assets.toString(),
  ])
}
