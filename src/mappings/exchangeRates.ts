import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { PriceFeed as PriceFeedContract } from '../../generated/ExchangeRates/PriceFeed'
import {
  ASSETS_USD_PRICE_FEED,
  EUR_USD_PRICE_FEED,
  GBP_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  USDC_USD_PRICE_FEED,
  SWISE_ASSET_UNI_POOL,
} from '../helpers/constants'
import { ExchangeRateSnapshot, UniswapPool } from '../../generated/schema'
import { createOrLoadNetwork } from '../entities/network'

export function handleExchangeRates(block: ethereum.Block): void {
  const decimals = BigDecimal.fromString('100000000')

  let assetsUsdRate = BigDecimal.zero()
  let swiseUsdRate = BigDecimal.zero()
  let daiUsdRate = BigDecimal.zero()
  let usdcUsdRate = BigDecimal.zero()
  let eurToUsdRate = BigDecimal.zero()
  let gbpToUsdRate = BigDecimal.zero()
  let response: BigInt
  let priceFeedContract: PriceFeedContract

  const assetsUsdPriceFeed = Address.fromString(ASSETS_USD_PRICE_FEED)
  if (assetsUsdPriceFeed.notEqual(Address.zero())) {
    priceFeedContract = PriceFeedContract.bind(assetsUsdPriceFeed)
    response = priceFeedContract.latestAnswer()
    assetsUsdRate = new BigDecimal(response).div(decimals)
  }

  const eurUsdPriceFeed = Address.fromString(EUR_USD_PRICE_FEED)
  if (eurUsdPriceFeed.notEqual(Address.zero())) {
    priceFeedContract = PriceFeedContract.bind(eurUsdPriceFeed)
    response = priceFeedContract.latestAnswer()
    eurToUsdRate = new BigDecimal(response).div(decimals)
  }

  const gbpUsdPriceFeed = Address.fromString(GBP_USD_PRICE_FEED)
  if (gbpUsdPriceFeed.notEqual(Address.zero())) {
    priceFeedContract = PriceFeedContract.bind(gbpUsdPriceFeed)
    response = priceFeedContract.latestAnswer()
    gbpToUsdRate = new BigDecimal(response).div(decimals)
  }

  const daiUsdPriceFeed = Address.fromString(DAI_USD_PRICE_FEED)
  if (daiUsdPriceFeed.notEqual(Address.zero())) {
    priceFeedContract = PriceFeedContract.bind(daiUsdPriceFeed)
    response = priceFeedContract.latestAnswer()
    daiUsdRate = new BigDecimal(response).div(decimals)
  }

  const usdcUsdPriceFeed = Address.fromString(USDC_USD_PRICE_FEED)
  if (usdcUsdPriceFeed.notEqual(Address.zero())) {
    priceFeedContract = PriceFeedContract.bind(usdcUsdPriceFeed)
    response = priceFeedContract.latestAnswer()
    usdcUsdRate = new BigDecimal(response).div(decimals)
  }

  const swiseAssetUniPool = Address.fromString(SWISE_ASSET_UNI_POOL)
  if (swiseAssetUniPool.notEqual(Address.zero())) {
    const pool = UniswapPool.load(swiseAssetUniPool.toHex())
    if (pool !== null) {
      const swiseAssetRate = new BigDecimal(pool.sqrtPrice.pow(2)).div(new BigDecimal(BigInt.fromI32(2).pow(192)))
      swiseUsdRate = swiseAssetRate.times(assetsUsdRate)
    }
  }

  const zero = BigDecimal.zero()
  const one = BigDecimal.fromString('1')
  const usdToEurRate = eurToUsdRate.gt(zero) ? one.div(eurToUsdRate) : zero
  const usdToGbpRate = gbpToUsdRate.gt(zero) ? one.div(gbpToUsdRate) : zero

  const network = createOrLoadNetwork()
  network.assetsUsdRate = assetsUsdRate
  network.swiseUsdRate = swiseUsdRate
  network.usdToEurRate = usdToEurRate
  network.usdToGbpRate = usdToGbpRate
  network.daiUsdRate = daiUsdRate
  network.usdcUsdRate = usdcUsdRate
  network.save()

  const exchangeRateSnapshot = new ExchangeRateSnapshot(block.timestamp.toString())
  exchangeRateSnapshot.timestamp = block.timestamp.toI64()
  exchangeRateSnapshot.assetsUsdRate = assetsUsdRate
  exchangeRateSnapshot.swiseUsdRate = swiseUsdRate
  exchangeRateSnapshot.daiUsdRate = daiUsdRate
  exchangeRateSnapshot.usdcUsdRate = usdcUsdRate
  exchangeRateSnapshot.usdToEurRate = usdToEurRate
  exchangeRateSnapshot.usdToGbpRate = usdToGbpRate
  exchangeRateSnapshot.save()

  log.info(
    '[ExchangeRates] assetsUsdRate={} usdToEurRate={} usdToGbpRate={} daiUsdRate={} usdcUsdRate={} swiseUsdRate={}',
    [
      assetsUsdRate.toString(),
      usdToEurRate.toString(),
      usdToGbpRate.toString(),
      daiUsdRate.toString(),
      usdcUsdRate.toString(),
      swiseUsdRate.toString(),
    ],
  )
}
