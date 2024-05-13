import { BigInt } from '@graphprotocol/graph-ts'
import { TokenHolder, TokenTransfer } from '../../generated/schema'

export function createOrLoadTokenHolder(tokenSymbol: string): TokenHolder {
  let token = TokenHolder.load(tokenSymbol)

  if (token === null) {
    token = new TokenHolder(tokenSymbol)

    token.transfersCount = BigInt.zero()
    token.save()
  }

  return token
}

export function createTokenTransfer(
  id: string,
  from: string,
  to: string,
  amount: BigInt,
  timestamp: BigInt,
  tokenSymbol: string,
): void {
  const transfer = new TokenTransfer(id)
  const tokenHolderFrom = createOrLoadTokenHolder(`${tokenSymbol}-${from}`)
  const tokenHolderTo = createOrLoadTokenHolder(`${tokenSymbol}-${to}`)

  transfer.to = to
  transfer.from = from
  transfer.amount = amount
  transfer.timestamp = timestamp
  transfer.tokenSymbol = tokenSymbol
  transfer.save()

  tokenHolderFrom.transfersCount = tokenHolderFrom.transfersCount.plus(BigInt.fromI32(1))
  tokenHolderTo.transfersCount = tokenHolderTo.transfersCount.plus(BigInt.fromI32(1))

  tokenHolderFrom.save()
  tokenHolderTo.save()
}
