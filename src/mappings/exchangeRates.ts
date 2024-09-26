import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { PriceFeed as PriceFeedContract } from '../../generated/ExchangeRates/PriceFeed'
import {
  ASSETS_USD_PRICE_FEED,
  EUR_USD_PRICE_FEED,
  GBP_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  ZERO_ADDRESS,
} from '../helpers/constants'
import { ExchangeRateSnapshot } from '../../generated/schema'
import { createOrLoadNetwork } from '../entities/network'

export function handleExchangeRates(block: ethereum.Block): void {
  const decimals = BigDecimal.fromString('100000000')

  let assetsUsdRate = BigDecimal.zero()
  let eurToUsdRate = BigDecimal.zero()
  let gbpToUsdRate = BigDecimal.zero()
  let daiToUsdRate = BigDecimal.zero()
  let response: BigInt
  let priceFeedContract: PriceFeedContract
  if (ASSETS_USD_PRICE_FEED != ZERO_ADDRESS) {
    priceFeedContract = PriceFeedContract.bind(Address.fromString(ASSETS_USD_PRICE_FEED))
    response = priceFeedContract.latestAnswer()
    assetsUsdRate = new BigDecimal(response).div(decimals)
  }

  if (EUR_USD_PRICE_FEED != ZERO_ADDRESS) {
    priceFeedContract = PriceFeedContract.bind(Address.fromString(EUR_USD_PRICE_FEED))
    response = priceFeedContract.latestAnswer()
    eurToUsdRate = new BigDecimal(response).div(decimals)
  }

  if (GBP_USD_PRICE_FEED != ZERO_ADDRESS) {
    priceFeedContract = PriceFeedContract.bind(Address.fromString(GBP_USD_PRICE_FEED))
    response = priceFeedContract.latestAnswer()
    gbpToUsdRate = new BigDecimal(response).div(decimals)
  }

  if (DAI_USD_PRICE_FEED != ZERO_ADDRESS) {
    priceFeedContract = PriceFeedContract.bind(Address.fromString(DAI_USD_PRICE_FEED))
    response = priceFeedContract.latestAnswer()
    daiToUsdRate = new BigDecimal(response).div(decimals)
  }

  const zero = BigDecimal.zero()
  const one = BigDecimal.fromString('1')
  const usdToEurRate = eurToUsdRate.gt(zero) ? one.div(eurToUsdRate) : zero
  const usdToGbpRate = gbpToUsdRate.gt(zero) ? one.div(gbpToUsdRate) : zero
  const usdToDaiRate = daiToUsdRate.gt(zero) ? one.div(daiToUsdRate) : zero

  const network = createOrLoadNetwork()
  network.assetsUsdRate = assetsUsdRate
  network.usdToEurRate = usdToEurRate
  network.usdToGbpRate = usdToGbpRate
  network.usdToDaiRate = usdToDaiRate
  network.save()

  const exchangeRateSnapshot = new ExchangeRateSnapshot('1')
  exchangeRateSnapshot.timestamp = block.timestamp.toI64()
  exchangeRateSnapshot.assetsUsdRate = assetsUsdRate
  exchangeRateSnapshot.usdToEurRate = usdToEurRate
  exchangeRateSnapshot.usdToGbpRate = usdToGbpRate
  exchangeRateSnapshot.save()

  log.info('[ExchangeRates] assetsUsdRate={} usdToEurRate={} usdToGbpRate={}', [
    assetsUsdRate.toString(),
    usdToEurRate.toString(),
    usdToGbpRate.toString(),
  ])
}
