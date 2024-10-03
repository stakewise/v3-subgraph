import { Address, BigInt } from '@graphprotocol/graph-ts'
import { SwiseTokenHolder, TokenTransfer } from '../../generated/schema'

export function createOrLoadSwiseTokenHolder(holderAddress: Address): SwiseTokenHolder {
  const id = holderAddress.toHex()
  let holder = SwiseTokenHolder.load(id)

  if (holder === null) {
    holder = new SwiseTokenHolder(id)
    holder.balance = BigInt.zero()
    holder.transfersCount = BigInt.zero()
    holder.save()
  }

  return holder
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
}
