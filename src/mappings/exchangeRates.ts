import { ethereum, log } from '@graphprotocol/graph-ts'
import { createOrLoadExchangeRate, updateExchangeRates } from '../entities/exchangeRates'

export function syncExchangeRates(block: ethereum.Block): void {
  const exchangeRate = createOrLoadExchangeRate()
  updateExchangeRates(exchangeRate, block.timestamp)

  log.info(
    '[ExchangeRates] assetsUsdRate={} ' +
      'usdToEurRate={} usdToGbpRate={} usdToCnyRate={} usdToJpyRate={} usdToKrwRate={} usdToAudRate={} ' +
      'daiUsdRate={} usdcUsdRate={} swiseUsdRate={} ssvUsdRate={} obolUsdRate={} lyxUsdRate={} ' +
      'btcUsdRate={} solUsdRate={} susdsUsdRate={} sdaiUsdRate={} bcspxUsdRate={} ' +
      'timestamp={}',
    [
      exchangeRate.assetsUsdRate.toString(),
      exchangeRate.usdToEurRate.toString(),
      exchangeRate.usdToGbpRate.toString(),
      exchangeRate.usdToCnyRate.toString(),
      exchangeRate.usdToJpyRate.toString(),
      exchangeRate.usdToKrwRate.toString(),
      exchangeRate.usdToAudRate.toString(),
      exchangeRate.daiUsdRate.toString(),
      exchangeRate.usdcUsdRate.toString(),
      exchangeRate.swiseUsdRate.toString(),
      exchangeRate.ssvUsdRate.toString(),
      exchangeRate.obolUsdRate.toString(),
      exchangeRate.lyxUsdRate.toString(),
      exchangeRate.btcUsdRate.toString(),
      exchangeRate.solUsdRate.toString(),
      exchangeRate.susdsUsdRate.toString(),
      exchangeRate.sdaiUsdRate.toString(),
      exchangeRate.bcspxUsdRate.toString(),
      block.timestamp.toString(),
    ],
  )
}
