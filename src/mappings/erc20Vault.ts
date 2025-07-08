import { Address, log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/templates/Erc20Vault/Erc20Vault'
import {
  AllocatorActionType,
  createAllocatorAction,
  createOrLoadAllocator,
  decreaseAllocatorShares,
  getAllocatorApy,
  increaseAllocatorShares,
  loadAllocator,
} from '../entities/allocator'
import { createTransaction } from '../entities/transaction'
import { convertSharesToAssets, loadVault } from '../entities/vault'
import { loadOsToken } from '../entities/osToken'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadDistributor } from '../entities/merkleDistributor'

// Event emitted on mint, burn or transfer shares between allocators
export function handleTransfer(event: Transfer): void {
  const params = event.params
  const vaultAddress = event.address
  const vault = loadVault(vaultAddress)!
  const osToken = loadOsToken()!
  const distributor = loadDistributor()!
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
  decreaseAllocatorShares(osToken, osTokenConfig, vault, allocatorFrom, shares)
  allocatorFrom.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocatorFrom)
  allocatorFrom.save()
  createAllocatorAction(event, vaultAddress, AllocatorActionType.TransferOut, from, assets, shares)

  const allocatorTo = createOrLoadAllocator(to, vaultAddress)
  increaseAllocatorShares(osToken, osTokenConfig, vault, allocatorTo, shares)
  allocatorTo.apy = getAllocatorApy(osToken, osTokenConfig, vault, distributor, allocatorTo)
  allocatorTo.save()
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
