import { BigInt } from '@graphprotocol/graph-ts'
import { Token, TokenTransfer } from '../../generated/schema'

export function createOrLoadToken(tokenSymbol: string): Token {
  let token = Token.load(tokenSymbol)

  if (token === null) {
    token = new Token(tokenSymbol)

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
  tokenSymbol: string,
): void {
  const transfer = new TokenTransfer(id)
  const token = createOrLoadToken(tokenSymbol)

  transfer.to = to
  transfer.from = from
  transfer.amount = amount
  transfer.token = token.id
  transfer.save()

  token.transfersCount = token.transfersCount.plus(BigInt.fromI32(1))
  token.save()
}
