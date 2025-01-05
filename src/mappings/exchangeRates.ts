import { ethereum, log } from '@graphprotocol/graph-ts'
import { loadNetwork } from '../entities/network'
import { updateExchangeRates } from '../entities/exchangeRates'

export function handleExchangeRates(block: ethereum.Block): void {
  const network = loadNetwork()!
  updateExchangeRates(network)

  log.info(
    '[ExchangeRates] assetsUsdRate={} usdToEurRate={} usdToGbpRate={} usdToCnyRate={} usdToJpyRate={} usdToKrwRate={} usdToAudRate={} daiUsdRate={} usdcUsdRate={} swiseUsdRate={} timestamp={}',
    [
      network.assetsUsdRate.toString(),
      network.usdToEurRate.toString(),
      network.usdToGbpRate.toString(),
      network.usdToCnyRate.toString(),
      network.usdToJpyRate.toString(),
      network.usdToKrwRate.toString(),
      network.usdToAudRate.toString(),
      network.daiUsdRate.toString(),
      network.usdcUsdRate.toString(),
      network.swiseUsdRate.toString(),
      block.timestamp.toString(),
    ],
  )
}
