import { Address, BigInt, log, store } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/OsToken/Erc20Token'
import { createOrLoadSwiseTokenHolder, createTokenTransfer } from '../entities/tokenTransfer'
import { MAIN_META_VAULT, OS_TOKEN, SWISE_TOKEN } from '../helpers/constants'
import {
  convertOsTokenSharesToAssets,
  createOrLoadOsTokenHolder,
  loadOsToken,
  loadOsTokenHolder,
} from '../entities/osToken'
import { createOrLoadUser, loadNetwork } from '../entities/network'
import { loadAllocator } from '../entities/allocator'
import { increaseStakerDepositedAssets, increaseStakerWithdrawnAssets, updateStaker } from '../entities/staker'

export function handleTransfer(event: Transfer): void {
  const tokenAddress = event.address
  let tokenSymbol: string
  if (tokenAddress.equals(OS_TOKEN)) {
    _handleOsTokenTransfer(event)
    tokenSymbol = 'osToken'
  } else if (tokenAddress.equals(SWISE_TOKEN)) {
    _handleSwiseTokenTransfer(event)
    tokenSymbol = 'SWISE'
  } else {
    log.error('[ERC20Token] Unknown token address {}', [tokenAddress.toHexString()])
    return
  }

  createTokenTransfer(
    `${event.transaction.hash.toHex()}-${event.logIndex.toString()}`,
    event.transaction.hash,
    event.params.from,
    event.params.to,
    event.params.value,
    event.block.timestamp,
    tokenSymbol,
  )

  log.info('[ERC20Token] Transfer token={} from={} to={} amount={}', [
    tokenSymbol,
    event.params.from.toHexString(),
    event.params.to.toHexString(),
    event.params.value.toString(),
  ])
}

function _handleSwiseTokenTransfer(event: Transfer): void {
  const from = event.params.from
  const to = event.params.to
  const amount = event.params.value

  if (amount.isZero()) {
    return
  }

  if (from.notEqual(Address.zero())) {
    const tokenHolderFrom = createOrLoadSwiseTokenHolder(from)

    tokenHolderFrom.balance = tokenHolderFrom.balance.minus(amount)
    tokenHolderFrom.transfersCount = tokenHolderFrom.transfersCount.plus(BigInt.fromI32(1))
    tokenHolderFrom.save()
  }
  if (to.notEqual(Address.zero())) {
    const tokenHolderTo = createOrLoadSwiseTokenHolder(to)
    tokenHolderTo.balance = tokenHolderTo.balance.plus(amount)
    tokenHolderTo.transfersCount = tokenHolderTo.transfersCount.plus(BigInt.fromI32(1))
    tokenHolderTo.save()
  }
}

function _handleOsTokenTransfer(event: Transfer): void {
  const from = event.params.from
  const to = event.params.to
  const amount = event.params.value

  if (amount.isZero()) {
    return
  }

  const mainMetaVaultAddress = Address.fromString(MAIN_META_VAULT)
  const osToken = loadOsToken()!
  const transferredAssets = convertOsTokenSharesToAssets(osToken, amount)

  if (from.notEqual(Address.zero())) {
    const tokenHolderFrom = loadOsTokenHolder(from)!
    tokenHolderFrom.balance = tokenHolderFrom.balance.minus(amount)
    tokenHolderFrom.transfersCount = tokenHolderFrom.transfersCount.plus(BigInt.fromI32(1))
    tokenHolderFrom.save()

    const allocatorFrom = loadAllocator(from, mainMetaVaultAddress)
    if (allocatorFrom !== null) {
      updateStaker(from)
      increaseStakerWithdrawnAssets(from, transferredAssets)
    }

    if (tokenHolderFrom.balance.isZero()) {
      const user = createOrLoadUser(from)
      if (user.vaultsCount === 0) {
        const network = loadNetwork()!
        network.usersCount = network.usersCount - 1
        network.save()
        store.remove('User', user.id)
      } else if (user.isOsTokenHolder) {
        user.isOsTokenHolder = false
        user.save()
      }
    }
  }
  if (to.notEqual(Address.zero())) {
    const tokenHolderTo = createOrLoadOsTokenHolder(to)
    tokenHolderTo.balance = tokenHolderTo.balance.plus(amount)
    tokenHolderTo.transfersCount = tokenHolderTo.transfersCount.plus(BigInt.fromI32(1))
    tokenHolderTo.save()

    const allocatorTo = loadAllocator(to, mainMetaVaultAddress)
    if (allocatorTo !== null) {
      updateStaker(to)
      increaseStakerDepositedAssets(to, transferredAssets)
    }

    const user = createOrLoadUser(to)
    if (!user.isOsTokenHolder) {
      if (user.vaultsCount === 0) {
        const network = loadNetwork()!
        network.usersCount = network.usersCount + 1
        network.save()
      }
      user.isOsTokenHolder = true
      user.save()
    }
  }
}
