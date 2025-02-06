import { ExchangeRateSnapshot, UniswapPool, ExchangeRate } from '../../generated/schema'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  ASSET_TOKEN,
  ASSETS_USD_PRICE_FEED,
  AUD_USD_PRICE_FEED,
  CNY_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  EUR_USD_PRICE_FEED,
  GBP_USD_PRICE_FEED,
  JPY_USD_PRICE_FEED,
  KRW_USD_PRICE_FEED,
  NETWORK,
  OS_TOKEN,
  SWISE_ASSET_UNI_POOL,
  SWISE_TOKEN,
  USDC_TOKEN,
  USDC_USD_PRICE_FEED,
  WAD,
} from '../helpers/constants'
import { chunkedMulticall } from '../helpers/utils'
import { isGnosisNetwork } from './network'
import { convertOsTokenSharesToAssets, loadOsToken } from './osToken'

const latestAnswerSelector = '0x50d25bcd'
const exchangeRateId = '0'

export function updateExchangeRates(exchangeRate: ExchangeRate, timestamp: BigInt): void {
  if (NETWORK == 'chiado' || NETWORK == 'holesky') {
    return
  }

  const latestAnswerCall = Bytes.fromHexString(latestAnswerSelector)
  const decimals = BigDecimal.fromString('100000000')

  let assetsUsdRate = BigDecimal.zero()
  let eurToUsdRate = BigDecimal.zero()
  let gbpToUsdRate = BigDecimal.zero()
  let cnyToUsdRate = BigDecimal.zero()
  let jpyToUsdRate = BigDecimal.zero()
  let krwToUsdRate = BigDecimal.zero()
  let audToUsdRate = BigDecimal.zero()
  let daiUsdRate = BigDecimal.zero()
  let usdcUsdRate = BigDecimal.zero()
  let swiseUsdRate = BigDecimal.zero()

  let contractAddresses: Array<Address>
  const isGnosis = isGnosisNetwork()
  if (isGnosis) {
    contractAddresses = [Address.fromString(ASSETS_USD_PRICE_FEED)]
  } else {
    contractAddresses = [
      Address.fromString(ASSETS_USD_PRICE_FEED),
      Address.fromString(EUR_USD_PRICE_FEED),
      Address.fromString(GBP_USD_PRICE_FEED),
      Address.fromString(CNY_USD_PRICE_FEED),
      Address.fromString(JPY_USD_PRICE_FEED),
      Address.fromString(KRW_USD_PRICE_FEED),
      Address.fromString(AUD_USD_PRICE_FEED),
      Address.fromString(DAI_USD_PRICE_FEED),
      Address.fromString(USDC_USD_PRICE_FEED),
    ]
  }
  const contractCalls: Array<Bytes> = []
  for (let i = 0; i < contractAddresses.length; i++) {
    contractCalls.push(latestAnswerCall)
  }

  let decodedValue: BigInt = BigInt.zero()
  const response = chunkedMulticall(contractAddresses, contractCalls, false)
  if (response[0] !== null) {
    decodedValue = ethereum.decode('int256', response[0]!)!.toBigInt()
    assetsUsdRate = decodedValue.toBigDecimal().div(decimals)
  }

  if (!isGnosis) {
    if (response[1] !== null) {
      decodedValue = ethereum.decode('int256', response[1]!)!.toBigInt()
      eurToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[2] !== null) {
      decodedValue = ethereum.decode('int256', response[2]!)!.toBigInt()
      gbpToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[3] !== null) {
      decodedValue = ethereum.decode('int256', response[3]!)!.toBigInt()
      cnyToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[4] !== null) {
      decodedValue = ethereum.decode('int256', response[4]!)!.toBigInt()
      jpyToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[5] !== null) {
      decodedValue = ethereum.decode('int256', response[5]!)!.toBigInt()
      krwToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[6] !== null) {
      decodedValue = ethereum.decode('int256', response[6]!)!.toBigInt()
      audToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[7] !== null) {
      decodedValue = ethereum.decode('int256', response[7]!)!.toBigInt()
      daiUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[8] !== null) {
      decodedValue = ethereum.decode('int256', response[8]!)!.toBigInt()
      usdcUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
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
  const usdToCnyRate = cnyToUsdRate.gt(zero) ? one.div(cnyToUsdRate) : zero
  const usdToJpyRate = jpyToUsdRate.gt(zero) ? one.div(jpyToUsdRate) : zero
  const usdToKrwRate = krwToUsdRate.gt(zero) ? one.div(krwToUsdRate) : zero
  const usdToAudRate = audToUsdRate.gt(zero) ? one.div(audToUsdRate) : zero

  const osToken = loadOsToken()!
  const wad = BigInt.fromString(WAD)
  const osTokenAssetsRate = convertOsTokenSharesToAssets(osToken, wad).toBigDecimal().div(wad.toBigDecimal())

  exchangeRate.osTokenAssetsRate = osTokenAssetsRate
  exchangeRate.assetsUsdRate = assetsUsdRate
  exchangeRate.swiseUsdRate = swiseUsdRate
  exchangeRate.usdToEurRate = usdToEurRate
  exchangeRate.usdToGbpRate = usdToGbpRate
  exchangeRate.usdToCnyRate = usdToCnyRate
  exchangeRate.usdToJpyRate = usdToJpyRate
  exchangeRate.usdToKrwRate = usdToKrwRate
  exchangeRate.usdToAudRate = usdToAudRate
  exchangeRate.daiUsdRate = daiUsdRate
  exchangeRate.usdcUsdRate = usdcUsdRate
  exchangeRate.save()

  const exchangeRateSnapshot = new ExchangeRateSnapshot(timestamp.toString())
  exchangeRateSnapshot.timestamp = timestamp.toI64()
  exchangeRateSnapshot.osTokenAssetsRate = osTokenAssetsRate
  exchangeRateSnapshot.assetsUsdRate = assetsUsdRate
  exchangeRateSnapshot.swiseUsdRate = swiseUsdRate
  exchangeRateSnapshot.daiUsdRate = daiUsdRate
  exchangeRateSnapshot.usdcUsdRate = usdcUsdRate
  exchangeRateSnapshot.usdToEurRate = usdToEurRate
  exchangeRateSnapshot.usdToGbpRate = usdToGbpRate
  exchangeRateSnapshot.usdToCnyRate = usdToCnyRate
  exchangeRateSnapshot.usdToJpyRate = usdToJpyRate
  exchangeRateSnapshot.usdToKrwRate = usdToKrwRate
  exchangeRateSnapshot.usdToAudRate = usdToAudRate
  exchangeRateSnapshot.save()
}

export function createOrLoadExchangeRate(): ExchangeRate {
  let exchangeRate = loadExchangeRate()

  if (exchangeRate === null) {
    exchangeRate = new ExchangeRate(exchangeRateId)
    exchangeRate.osTokenAssetsRate = BigDecimal.zero()
    exchangeRate.assetsUsdRate = BigDecimal.zero()
    exchangeRate.swiseUsdRate = BigDecimal.zero()
    exchangeRate.daiUsdRate = BigDecimal.zero()
    exchangeRate.usdcUsdRate = BigDecimal.zero()
    exchangeRate.usdToEurRate = BigDecimal.zero()
    exchangeRate.usdToGbpRate = BigDecimal.zero()
    exchangeRate.usdToCnyRate = BigDecimal.zero()
    exchangeRate.usdToJpyRate = BigDecimal.zero()
    exchangeRate.usdToKrwRate = BigDecimal.zero()
    exchangeRate.usdToAudRate = BigDecimal.zero()
    exchangeRate.save()
  }

  return exchangeRate
}

export function loadExchangeRate(): ExchangeRate | null {
  return ExchangeRate.load(exchangeRateId)
}

export function convertTokenAmountToAssets(exchangeRate: ExchangeRate, token: Address, amount: BigInt): BigInt {
  if (token.equals(Address.fromString(ASSET_TOKEN))) {
    return amount
  }
  if (token.equals(OS_TOKEN)) {
    return amount.toBigDecimal().times(exchangeRate.osTokenAssetsRate).digits
  }
  if (token.equals(SWISE_TOKEN)) {
    return amount.toBigDecimal().times(exchangeRate.swiseUsdRate).div(exchangeRate.assetsUsdRate).digits
  }
  if (token.equals(Address.fromString(USDC_TOKEN))) {
    return amount.toBigDecimal().times(exchangeRate.usdcUsdRate).div(exchangeRate.assetsUsdRate).digits
  }
  assert(false, 'Cannot convert to assets unsupported token=' + token.toHexString())
  return BigInt.zero()
}
