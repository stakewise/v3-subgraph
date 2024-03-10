import { Address, store, log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/templates/Erc20Vault/Erc20Vault'
import { createAllocatorAction, createOrLoadAllocator } from '../entities/allocator'
import { createTransaction } from '../entities/transaction'

// Event emitted on mint, burn or transfer shares between allocators
export function handleTransfer(event: Transfer): void {
  const params = event.params

  const from = params.from
  const to = params.to
  const value = params.value
  const vaultAddress = event.address

  const zeroAddress = Address.zero()
  if (from.equals(zeroAddress) || to.equals(zeroAddress)) {
    // mint and burn are handled in handleDeposit, handleWithdraw mappings
    return
  }

  const allocatorFrom = createOrLoadAllocator(from, vaultAddress)
  allocatorFrom.shares = allocatorFrom.shares.minus(value)
  if (allocatorFrom.shares.isZero()) {
    store.remove('Allocator', allocatorFrom.id)
  } else {
    allocatorFrom.save()
  }
  createAllocatorAction(event, vaultAddress, 'TransferOut', from, null, value)

  const allocatorTo = createOrLoadAllocator(to, vaultAddress)
  allocatorTo.shares = allocatorTo.shares.plus(value)
  allocatorTo.save()
  createAllocatorAction(event, vaultAddress, 'TransferIn', to, null, value)

  createTransaction(event.transaction.hash.toHex())

  log.info('[Vault] Transfer vault={} from={} to={} value={}', [
    vaultAddress.toHex(),
    params.from.toHex(),
    params.to.toHex(),
    params.value.toString(),
  ])
}
