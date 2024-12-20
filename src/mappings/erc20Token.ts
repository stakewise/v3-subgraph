import { Address, BigInt, log, store } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/OsToken/Erc20Token'
import { createOrLoadSwiseTokenHolder, createTokenTransfer } from '../entities/tokenTransfer'
import { OS_TOKEN, SWISE_TOKEN } from '../helpers/constants'
import { loadOsToken } from '../entities/osToken'
import { createOrLoadUser, loadNetwork } from '../entities/network'
import {
  createOrLoadOsTokenHolder,
  getOsTokenHolderApy,
  loadOsTokenHolder,
  snapshotOsTokenHolder,
  updateOsTokenHolderAssets,
} from '../entities/osTokenHolder'

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
    event.transaction.hash.toHex(),
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
  const timestamp = event.block.timestamp

  const network = loadNetwork()!
  const osToken = loadOsToken()!
  if (from.notEqual(Address.zero())) {
    const tokenHolderFrom = loadOsTokenHolder(from)!
    tokenHolderFrom.balance = tokenHolderFrom.balance.minus(amount)
    tokenHolderFrom.transfersCount = tokenHolderFrom.transfersCount.plus(BigInt.fromI32(1))
    updateOsTokenHolderAssets(osToken, tokenHolderFrom)
    tokenHolderFrom.apy = getOsTokenHolderApy(network, osToken, tokenHolderFrom, false)
    tokenHolderFrom.save()
    snapshotOsTokenHolder(network, osToken, tokenHolderFrom, BigInt.zero(), timestamp)

    const user = createOrLoadUser(from)
    if (tokenHolderFrom.balance.isZero() && user.vaultsCount === 0) {
      const network = loadNetwork()!
      network.usersCount = network.usersCount - 1
      network.save()
      store.remove('User', user.id)
    }
  }
  if (to.notEqual(Address.zero())) {
    const tokenHolderTo = createOrLoadOsTokenHolder(to)
    tokenHolderTo.balance = tokenHolderTo.balance.plus(amount)
    tokenHolderTo.transfersCount = tokenHolderTo.transfersCount.plus(BigInt.fromI32(1))
    updateOsTokenHolderAssets(osToken, tokenHolderTo)
    tokenHolderTo.apy = getOsTokenHolderApy(network, osToken, tokenHolderTo, false)
    tokenHolderTo.save()
    snapshotOsTokenHolder(network, osToken, tokenHolderTo, BigInt.zero(), timestamp)

    const user = createOrLoadUser(to)
    if (!user.isOsTokenHolder && user.vaultsCount === 0 && tokenHolderTo.balance.gt(BigInt.zero())) {
      const network = loadNetwork()!
      network.usersCount = network.usersCount + 1
      network.save()

      user.isOsTokenHolder = true
      user.save()
    }
  }
}
