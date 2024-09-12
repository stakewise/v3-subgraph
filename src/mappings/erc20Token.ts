import { log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/OsToken/Erc20Token'
import { createTokenTransfer } from '../entities/tokenTransfer'
import { OS_TOKEN, SWISE_TOKEN } from '../helpers/constants'

export function handleTransfer(event: Transfer): void {
  const tokenAddress = event.address
  let tokenSymbol = ''
  if (tokenAddress.equals(SWISE_TOKEN)) {
    tokenSymbol = 'SWISE'
  } else if (tokenAddress.equals(OS_TOKEN)) {
    tokenSymbol = 'osToken'
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
