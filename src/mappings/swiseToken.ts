import { log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/Erc20Token/Erc20Token'
import { createTokenTransfer } from '../entities/tokenTransfer'


export function handleTransfer(event: Transfer): void {
  createTokenTransfer(
    event.transaction.hash.toHex(),
    event.params.from.toHexString(),
    event.params.to.toHexString(),
    event.params.value,
    event.block.timestamp,
    'swise',
  )

  log.info('[SwiseToken] Transfer from={} to={} amount={}', [
    event.params.from.toHexString(),
    event.params.to.toHexString(),
    event.params.value.toString(),
  ])
}
