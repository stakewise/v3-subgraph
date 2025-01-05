import { Network, UniswapPool } from '../../generated/schema'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  ASSETS_USD_PRICE_FEED,
  AUD_USD_PRICE_FEED,
  CNY_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  EUR_USD_PRICE_FEED,
  GBP_USD_PRICE_FEED,
  JPY_USD_PRICE_FEED,
  KRW_USD_PRICE_FEED,
  NETWORK,
  SWISE_ASSET_UNI_POOL,
  USDC_USD_PRICE_FEED,
} from '../helpers/constants'
import { chunkedMulticall } from '../helpers/utils'
import { isGnosisNetwork } from './network'

const latestAnswerSelector = '0x50d25bcd'

export function updateExchangeRates(network: Network): void {
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

  network.assetsUsdRate = assetsUsdRate
  network.swiseUsdRate = swiseUsdRate
  network.usdToEurRate = usdToEurRate
  network.usdToGbpRate = usdToGbpRate
  network.usdToCnyRate = usdToCnyRate
  network.usdToJpyRate = usdToJpyRate
  network.usdToKrwRate = usdToKrwRate
  network.usdToAudRate = usdToAudRate
  network.daiUsdRate = daiUsdRate
  network.usdcUsdRate = usdcUsdRate
  network.save()
}
