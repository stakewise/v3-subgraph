import { Address, log } from '@graphprotocol/graph-ts'
import { TokensConverterCreated } from '../../generated/XdaiConverterFactory/XdaiConverterFactory'
import { createXdaiConverter } from '../entities/xdaiConverter'

export function handleTokensConverterCreated(event: TokensConverterCreated): void {
  const converter = createXdaiConverter(
    Address.fromBytes(event.params.vault),
    Address.fromBytes(event.params.converter),
  )
  log.info('[XdaiConverterFactory] TokensConverterCreated address={} vault={}', [
    converter.address.toHexString(),
    converter.id,
  ])
}
