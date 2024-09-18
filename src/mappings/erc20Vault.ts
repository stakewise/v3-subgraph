import { Address, log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/templates/Erc20Vault/Erc20Vault'
import { Vault } from '../../generated/schema'
import {
  createAllocatorAction,
  createOrLoadAllocator,
  getAllocatorLtv,
  getAllocatorOsTokenMintApy,
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
  allocatorFrom.osTokenMintApy = getAllocatorOsTokenMintApy(allocatorFrom, osToken.apy, osToken, osTokenConfig)
  allocatorFrom.save()
  if (allocatorFrom.shares.isZero()) {
    decreaseUserVaultsCount(allocatorFrom.address)
  }
  createAllocatorAction(event, vaultAddress, 'TransferOut', from, assets, shares)

  const allocatorTo = createOrLoadAllocator(to, vaultAddress)
  if (allocatorTo.shares.isZero() && !shares.isZero()) {
    increaseUserVaultsCount(allocatorTo.address)
  }
  allocatorTo.shares = allocatorTo.shares.plus(shares)
  allocatorTo.assets = convertSharesToAssets(vault, allocatorTo.shares)
  allocatorFrom.ltv = getAllocatorLtv(allocatorFrom, osToken)
  allocatorFrom.osTokenMintApy = getAllocatorOsTokenMintApy(allocatorFrom, osToken.apy, osToken, osTokenConfig)
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
