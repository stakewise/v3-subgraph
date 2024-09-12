import { Address, store, log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/templates/Erc20Vault/Erc20Vault'
import { Vault } from '../../generated/schema'
import { createAllocatorAction, createOrLoadAllocator } from '../entities/allocator'
import { createTransaction } from '../entities/transaction'
import { convertSharesToAssets } from '../entities/vaults'

// Event emitted on mint, burn or transfer shares between allocators
export function handleTransfer(event: Transfer): void {
  const params = event.params
  const vaultAddress = event.address
  const vault = Vault.load(vaultAddress.toHex()) as Vault

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
  if (allocatorFrom.shares.isZero()) {
    store.remove('Allocator', allocatorFrom.id)
  } else {
    allocatorFrom.save()
  }
  createAllocatorAction(event, vaultAddress, 'TransferOut', from, assets, shares)

  const allocatorTo = createOrLoadAllocator(to, vaultAddress)
  allocatorTo.shares = allocatorTo.shares.plus(shares)
  allocatorTo.assets = convertSharesToAssets(vault, allocatorTo.shares)
  allocatorTo.save()
  createAllocatorAction(event, vaultAddress, 'TransferIn', to, assets, shares)

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Transfer vault={} from={} to={} shares={} assets={}', [
    vaultAddress.toHex(),
    from.toHex(),
    to.toHex(),
    shares.toString(),
    assets.toString(),
  ])
}
