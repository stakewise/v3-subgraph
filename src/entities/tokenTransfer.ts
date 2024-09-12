import { Address, BigInt } from '@graphprotocol/graph-ts'
import { TokenHolder, TokenTransfer } from '../../generated/schema'

export function createOrLoadTokenHolder(tokenSymbol: string, tokenHolderAddress: Address): TokenHolder {
  const id = `${tokenSymbol}-${tokenHolderAddress.toHex()}`

  let token = TokenHolder.load(id)

  if (token === null) {
    token = new TokenHolder(id)

    token.address = tokenHolderAddress
    token.tokenSymbol = tokenSymbol
    token.balance = BigInt.zero()
    token.transfersCount = BigInt.zero()
    token.save()
  }

  return token
}

export function createTokenTransfer(
  id: string,
  from: Address,
  to: Address,
  amount: BigInt,
  timestamp: BigInt,
  tokenSymbol: string,
): void {
  const transfer = new TokenTransfer(id)

  transfer.to = to
  transfer.from = from
  transfer.amount = amount
  transfer.timestamp = timestamp
  transfer.tokenSymbol = tokenSymbol
  transfer.save()

  if (from != Address.zero()) {
    const tokenHolderFrom = createOrLoadTokenHolder(tokenSymbol, from)

    tokenHolderFrom.balance = tokenHolderFrom.balance.minus(amount)
    tokenHolderFrom.transfersCount = tokenHolderFrom.transfersCount.plus(BigInt.fromI32(1))
    tokenHolderFrom.save()
  }
  if (to != Address.zero()) {
    const tokenHolderTo = createOrLoadTokenHolder(tokenSymbol, to)
    tokenHolderTo.balance = tokenHolderTo.balance.plus(amount)
    tokenHolderTo.transfersCount = tokenHolderTo.transfersCount.plus(BigInt.fromI32(1))
    tokenHolderTo.save()
  }
}
