import { ExchangeRateSnapshot, UniswapPool, ExchangeRate } from '../../generated/schema'
import {Address, BigDecimal, BigInt, Bytes, ethereum, log} from '@graphprotocol/graph-ts'
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
  SSV_ASSET_UNI_POOL,
  SWISE_TOKEN,
  SSV_TOKEN,
  USDC_TOKEN,
  USDC_USD_PRICE_FEED,
  BTC_USD_PRICE_FEED,
  SOL_USD_PRICE_FEED,
  USDS_USD_PRICE_FEED,
  ETH_USD_PRICE_FEED,
  BCSPX_USD_PRICE_FEED,
  SUSDS_TOKEN,
  SDAI_TOKEN,
  WAD,
} from '../helpers/constants'
import { chunkedMulticall } from '../helpers/utils'
import { isGnosisNetwork } from './network'
import { convertOsTokenSharesToAssets, loadOsToken } from './osToken'

const latestAnswerSelector = '0x50d25bcd'  // uniswap
const getRateSelector = '0x679aefce' // balancer
const convertToAssetsSelector = '0x07a2d13a' // erc4626 convertToAssets
const exchangeRateId = '0'

export function updateExchangeRates(exchangeRate: ExchangeRate, timestamp: BigInt): void {
  const osToken = loadOsToken()!
  const wad = BigInt.fromString(WAD)
  const osTokenAssetsRate = convertOsTokenSharesToAssets(osToken, wad).toBigDecimal().div(wad.toBigDecimal())
  if (NETWORK == 'chiado' || NETWORK == 'holesky') {
    exchangeRate.osTokenAssetsRate = osTokenAssetsRate
    exchangeRate.assetsUsdRate = BigDecimal.fromString('2723.05')
    exchangeRate.swiseUsdRate = BigDecimal.fromString('0.01461953570159260834000550061571017')
    exchangeRate.daiUsdRate = BigDecimal.fromString('1.00002222')
    exchangeRate.usdcUsdRate = BigDecimal.fromString('0.99988307')
    exchangeRate.usdToEurRate = BigDecimal.fromString('0.9591498096087627926605856568737471')
    exchangeRate.usdToGbpRate = BigDecimal.fromString('0.7944831092890965138081164394444974')
    exchangeRate.usdToCnyRate = BigDecimal.fromString('7.281070055179589413178518367773401')
    exchangeRate.usdToJpyRate = BigDecimal.fromString('151.4061849426549074529694538021878')
    exchangeRate.usdToKrwRate = BigDecimal.fromString('1441.109077546079462754535890821576')
    exchangeRate.usdToAudRate = BigDecimal.fromString('1.576267713308428303463060166138617')
    exchangeRate.ssvUsdRate = BigDecimal.fromString('11.9')
    exchangeRate.save()
    return
  }

  // chainlink oracle
  const latestAnswerCall = Bytes.fromHexString(latestAnswerSelector)
  // balancer rate provider
  const getRateCall = Bytes.fromHexString(getRateSelector)

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
  let ssvUsdRate = BigDecimal.zero()
  let ethUsdRate = BigDecimal.zero()
  let btcUsdRate = BigDecimal.zero()
  let solUsdRate = BigDecimal.zero()
  let usdsUsdRate = BigDecimal.zero()
  let susdsUsdRate = BigDecimal.zero()
  let sdaiUsdRate = BigDecimal.zero()
  let bcspxUsdRate = BigDecimal.zero()

  let contractAddresses: Array<Address>
  const isGnosis = isGnosisNetwork()
    if (isGnosis) {
    contractAddresses = [
        Address.fromString(ASSETS_USD_PRICE_FEED),
        Address.fromString(DAI_USD_PRICE_FEED),
        Address.fromString(ETH_USD_PRICE_FEED),
        Address.fromString(BTC_USD_PRICE_FEED),
    ]
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
      Address.fromString(BTC_USD_PRICE_FEED),
      Address.fromString(SOL_USD_PRICE_FEED),
      Address.fromString(USDS_USD_PRICE_FEED),
    ]
  }
  const contractCalls: Array<Bytes> = []
  for (let i = 0; i < contractAddresses.length; i++) {
    contractCalls.push(latestAnswerCall)
  }

  if (isGnosis) {
    // sdai <-> dai conversion rate
    contractAddresses.push(Address.fromString(SDAI_TOKEN))
    const decimalsInt = BigInt.fromString('100000000')
    const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(decimalsInt))
    const convertToAssetsCall = Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
    contractCalls.push(convertToAssetsCall)
  } else {
    // susds <-> usds conversion rate
    contractAddresses.push(Address.fromString(SUSDS_TOKEN))
    const decimalsInt = BigInt.fromString('100000000')
    const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(decimalsInt))
    const convertToAssetsCall = Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
    contractCalls.push(convertToAssetsCall)

  }
  let decodedValue: BigInt = BigInt.zero()
  const response = chunkedMulticall(contractAddresses, contractCalls, false)
  if (response[0] !== null) {
    decodedValue = ethereum.decode('int256', response[0]!)!.toBigInt()
    assetsUsdRate = decodedValue.toBigDecimal().div(decimals)
  }

  if (isGnosis) {
    if (response[1] !== null) {
      decodedValue = ethereum.decode('int256', response[1]!)!.toBigInt()
      daiUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[2] !== null) {
      decodedValue = ethereum.decode('int256', response[2]!)!.toBigInt()
      ethUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[3] !== null) {
      decodedValue = ethereum.decode('int256', response[3]!)!.toBigInt()
      btcUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[1] !== null && response[4] !== null) {
      decodedValue = ethereum.decode('int256', response[4]!)!.toBigInt()
      const sdaiDaiRate = decodedValue.toBigDecimal().div(decimals)
      sdaiUsdRate = sdaiDaiRate.times(daiUsdRate)
    }
  } else {
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
    if (response[9] !== null) {
      decodedValue = ethereum.decode('int256', response[9]!)!.toBigInt()
      btcUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[10] !== null) {
      decodedValue = ethereum.decode('int256', response[10]!)!.toBigInt()
      solUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (response[11] !== null && response[12] !== null) {
      decodedValue = ethereum.decode('int256', response[11]!)!.toBigInt()
      usdsUsdRate = decodedValue.toBigDecimal().div(decimals)
      decodedValue = ethereum.decode('int256', response[12]!)!.toBigInt()
      const susdsUsdsRate = decodedValue.toBigDecimal().div(decimals)
      susdsUsdRate = usdsUsdRate.times(susdsUsdsRate)
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

  const ssvAssetUniPool = Address.fromString(SSV_ASSET_UNI_POOL)
  if (ssvAssetUniPool.notEqual(Address.zero())) {
    const pool = UniswapPool.load(ssvAssetUniPool.toHex())
    if (pool !== null) {
      const ssvAssetRate = new BigDecimal(pool.sqrtPrice.pow(2)).div(new BigDecimal(BigInt.fromI32(2).pow(192)))
      ssvUsdRate = ssvAssetRate.times(assetsUsdRate)
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
  exchangeRate.ssvUsdRate = ssvUsdRate
  exchangeRate.ethUsdRate = ethUsdRate
  exchangeRate.btcUsdRate = btcUsdRate
  exchangeRate.solUsdRate = solUsdRate
  exchangeRate.susdsUsdRate = susdsUsdRate
  exchangeRate.sdaiUsdRate = sdaiUsdRate  // todo
  exchangeRate.bcspxUsdRate = bcspxUsdRate  // todo
  exchangeRate.usdcUsdRate = usdcUsdRate
  exchangeRate.save()

  const exchangeRateSnapshot = new ExchangeRateSnapshot(timestamp.toString())
  exchangeRateSnapshot.timestamp = timestamp.toI64()
  exchangeRateSnapshot.osTokenAssetsRate = osTokenAssetsRate
  exchangeRateSnapshot.assetsUsdRate = assetsUsdRate
  exchangeRateSnapshot.swiseUsdRate = swiseUsdRate
  exchangeRateSnapshot.daiUsdRate = daiUsdRate
  exchangeRateSnapshot.ssvUsdRate = ssvUsdRate
  exchangeRateSnapshot.ethUsdRate = ethUsdRate
  exchangeRateSnapshot.btcUsdRate = btcUsdRate
  exchangeRateSnapshot.solUsdRate = solUsdRate
  exchangeRateSnapshot.susdsUsdRate = susdsUsdRate
  exchangeRateSnapshot.sdaiUsdRate = sdaiUsdRate
  exchangeRateSnapshot.bcspxUsdRate = bcspxUsdRate
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
    exchangeRate.ssvUsdRate = BigDecimal.zero()
    exchangeRate.ethUsdRate = BigDecimal.zero()
    exchangeRate.btcUsdRate = BigDecimal.zero()
    exchangeRate.solUsdRate = BigDecimal.zero()
    exchangeRate.susdsUsdRate = BigDecimal.zero()
    exchangeRate.sdaiUsdRate = BigDecimal.zero()
    exchangeRate.btcUsdRate = BigDecimal.zero()
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

export function isTokenSupported(token: Address): boolean {
  if (token.equals(Address.zero())) {
    return false
  }
  return (
    token.equals(Address.fromString(ASSET_TOKEN)) ||
    token.equals(OS_TOKEN) ||
    token.equals(SWISE_TOKEN) ||
    token.equals(Address.fromString(SSV_TOKEN)) ||
    token.equals(Address.fromString(USDC_TOKEN))
  )
}

export function convertTokenAmountToAssets(exchangeRate: ExchangeRate, token: Address, amount: BigInt): BigInt {
  if (token.equals(Address.fromString(ASSET_TOKEN))) {
    return amount
  }
  if (token.equals(OS_TOKEN)) {
    return amount.toBigDecimal().times(exchangeRate.osTokenAssetsRate).truncate(0).digits
  }
  if (token.equals(SWISE_TOKEN)) {
    return amount.toBigDecimal().times(exchangeRate.swiseUsdRate).div(exchangeRate.assetsUsdRate).truncate(0).digits
  }
  if (token.equals(Address.fromString(SSV_TOKEN))) {
    return amount.toBigDecimal().times(exchangeRate.ssvUsdRate).div(exchangeRate.assetsUsdRate).truncate(0).digits
  }
  if (token.equals(Address.fromString(USDC_TOKEN))) {
    return amount.toBigDecimal().times(exchangeRate.usdcUsdRate).div(exchangeRate.assetsUsdRate).truncate(0).digits
  }
  assert(false, 'Cannot convert to assets unsupported token=' + token.toHexString())
  return BigInt.zero()
}
