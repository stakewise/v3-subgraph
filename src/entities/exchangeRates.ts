import { ExchangeRate, ExchangeRateSnapshot, UniswapPool } from '../../generated/schema'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  ASSET_TOKEN,
  ASSETS_USD_PRICE_FEED,
  AUD_USD_PRICE_FEED,
  BALANCER_QUERY,
  BCSPX_SDAI_BALANCER_POOL,
  BCSPX_TOKEN,
  BTC_USD_PRICE_FEED,
  CNY_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  ETH_USD_PRICE_FEED,
  EUR_USD_PRICE_FEED,
  GBP_USD_PRICE_FEED,
  JPY_USD_PRICE_FEED,
  KRW_USD_PRICE_FEED,
  NETWORK,
  OS_TOKEN,
  SDAI_TOKEN,
  SOL_USD_PRICE_FEED,
  SSV_ASSET_UNI_POOL,
  SSV_TOKEN,
  SUSDS_TOKEN,
  SWISE_ASSET_UNI_POOL,
  SWISE_TOKEN,
  USDC_TOKEN,
  USDC_USD_PRICE_FEED,
  USDS_USD_PRICE_FEED,
  WAD,
  ZERO_ADDRESS,
} from '../helpers/constants'
import { chunkedMulticall, encodeContractCall } from '../helpers/utils'
import { isGnosisNetwork } from './network'
import { convertOsTokenSharesToAssets, loadOsToken } from './osToken'

const latestAnswerSelector = '0x50d25bcd' // uniswap
const querySwapSelector = '0xe969f6b3' // balancer
const convertToAssetsSelector = '0x07a2d13a' // erc4626 convertToAssets
const exchangeRateId = '0'

export function updateExchangeRates(exchangeRate: ExchangeRate, timestamp: BigInt): void {
  const osToken = loadOsToken()!
  const wad = BigInt.fromString(WAD)
  const osTokenAssetsRate = convertOsTokenSharesToAssets(osToken, wad).toBigDecimal().div(wad.toBigDecimal())
  if (NETWORK == 'chiado' || NETWORK == 'hoodi') {
    exchangeRate.osTokenAssetsRate = osTokenAssetsRate
    exchangeRate.assetsUsdRate = BigDecimal.fromString('1905.012302')
    exchangeRate.swiseUsdRate = BigDecimal.fromString('0.009594236721804157655299186623941473')
    exchangeRate.daiUsdRate = BigDecimal.fromString('0.9998633')
    exchangeRate.usdcUsdRate = BigDecimal.fromString('0.99996')
    exchangeRate.usdToEurRate = BigDecimal.fromString('0.9264406151565684639614600704094868')
    exchangeRate.usdToGbpRate = BigDecimal.fromString('0.7739518756723706919903720386666357')
    exchangeRate.usdToCnyRate = BigDecimal.fromString('7.267620381954149745829512381917521')
    exchangeRate.usdToJpyRate = BigDecimal.fromString('149.5841560461915873870639621851254')
    exchangeRate.usdToKrwRate = BigDecimal.fromString('1471.627030845302566517541794207676')
    exchangeRate.usdToAudRate = BigDecimal.fromString('1.594184415253156485142201249840582')
    exchangeRate.ssvUsdRate = BigDecimal.fromString('6.718973139778290779340878068066559')
    exchangeRate.ethUsdRate = BigDecimal.fromString('1905.012302')
    exchangeRate.btcUsdRate = BigDecimal.fromString('85111.59')
    exchangeRate.solUsdRate = BigDecimal.fromString('128.23')
    exchangeRate.susdsUsdRate = BigDecimal.fromString('1.05')
    exchangeRate.sdaiUsdRate = BigDecimal.fromString('1.15762623')
    exchangeRate.bcspxUsdRate = BigDecimal.fromString('625.62')
    exchangeRate.save()

    const exchangeRateSnapshot = new ExchangeRateSnapshot(1)
    exchangeRateSnapshot.timestamp = timestamp.toI64()
    exchangeRateSnapshot.osTokenAssetsRate = osTokenAssetsRate
    exchangeRateSnapshot.assetsUsdRate = exchangeRate.assetsUsdRate
    exchangeRateSnapshot.swiseUsdRate = exchangeRate.swiseUsdRate
    exchangeRateSnapshot.daiUsdRate = exchangeRate.daiUsdRate
    exchangeRateSnapshot.usdcUsdRate = exchangeRate.usdcUsdRate
    exchangeRateSnapshot.usdToEurRate = exchangeRate.usdToEurRate
    exchangeRateSnapshot.usdToGbpRate = exchangeRate.usdToGbpRate
    exchangeRateSnapshot.usdToCnyRate = exchangeRate.usdToCnyRate
    exchangeRateSnapshot.usdToJpyRate = exchangeRate.usdToJpyRate
    exchangeRateSnapshot.usdToKrwRate = exchangeRate.usdToKrwRate
    exchangeRateSnapshot.usdToAudRate = exchangeRate.usdToAudRate
    exchangeRateSnapshot.ssvUsdRate = exchangeRate.ssvUsdRate
    exchangeRateSnapshot.ethUsdRate = exchangeRate.ethUsdRate
    exchangeRateSnapshot.btcUsdRate = exchangeRate.btcUsdRate
    exchangeRateSnapshot.solUsdRate = exchangeRate.solUsdRate
    exchangeRateSnapshot.susdsUsdRate = exchangeRate.susdsUsdRate
    exchangeRateSnapshot.sdaiUsdRate = exchangeRate.sdaiUsdRate
    exchangeRateSnapshot.bcspxUsdRate = exchangeRate.bcspxUsdRate
    exchangeRateSnapshot.save()
    return
  }

  // chainlink oracle
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
  let ssvUsdRate = BigDecimal.zero()
  let ethUsdRate = BigDecimal.zero()
  let btcUsdRate = BigDecimal.zero()
  let solUsdRate = BigDecimal.zero()
  let usdsUsdRate = BigDecimal.zero()
  let susdsUsdRate = BigDecimal.zero()
  let sdaiUsdRate = BigDecimal.zero()
  let bcspxUsdRate = BigDecimal.zero()

  let contractCalls: Array<ethereum.Value>
  const isGnosis = isGnosisNetwork()
  if (isGnosis) {
    contractCalls = [
      encodeContractCall(Address.fromString(ASSETS_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(DAI_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(ETH_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(BTC_USD_PRICE_FEED), latestAnswerCall),
    ]
  } else {
    contractCalls = [
      encodeContractCall(Address.fromString(ASSETS_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(EUR_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(GBP_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(CNY_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(JPY_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(KRW_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(AUD_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(DAI_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(USDC_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(BTC_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(SOL_USD_PRICE_FEED), latestAnswerCall),
      encodeContractCall(Address.fromString(USDS_USD_PRICE_FEED), latestAnswerCall),
    ]
  }

  if (isGnosis) {
    // sdai <-> dai conversion rate
    const decimalsInt = BigInt.fromString('100000000')
    const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(decimalsInt))
    const convertToAssetsCall = Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
    contractCalls.push(encodeContractCall(Address.fromString(SDAI_TOKEN), convertToAssetsCall))

    // sdai <-> bcspx conversion rate via balancer querySwap func
    const FirstTupleOffset = Bytes.fromHexString('00000000000000000000000000000000000000000000000000000000000000a0')
    const AppBytesOffset = Bytes.fromHexString('00000000000000000000000000000000000000000000000000000000000000c0')
    const AppBytesValue = Bytes.fromHexString('0000000000000000000000000000000000000000000000000000000000000000')
    const encodedQuerySwapArgs = ethereum
      .encode(ethereum.Value.fromFixedBytes(FirstTupleOffset))!
      .concat(ethereum.encode(ethereum.Value.fromAddress(Address.fromString(ZERO_ADDRESS)))!)
      .concat(ethereum.encode(ethereum.Value.fromI32(0))!)
      .concat(ethereum.encode(ethereum.Value.fromAddress(Address.fromString(ZERO_ADDRESS)))!)
      .concat(ethereum.encode(ethereum.Value.fromI32(0))!)
      .concat(ethereum.encode(ethereum.Value.fromFixedBytes(Bytes.fromHexString(BCSPX_SDAI_BALANCER_POOL)))!)
      .concat(ethereum.encode(ethereum.Value.fromI32(0))!)
      .concat(ethereum.encode(ethereum.Value.fromAddress(Address.fromString(BCSPX_TOKEN)))!)
      .concat(ethereum.encode(ethereum.Value.fromAddress(Address.fromString(SDAI_TOKEN)))!)
      .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(decimalsInt))!)
      .concat(ethereum.encode(ethereum.Value.fromFixedBytes(AppBytesOffset))!)
      .concat(ethereum.encode(ethereum.Value.fromFixedBytes(AppBytesValue))!)

    const querySwapCall = Bytes.fromHexString(querySwapSelector).concat(encodedQuerySwapArgs as Bytes)
    contractCalls.push(encodeContractCall(Address.fromString(BALANCER_QUERY), querySwapCall))
  } else {
    // susds <-> usds conversion rate
    const decimalsInt = BigInt.fromString('100000000')
    const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(decimalsInt))
    const convertToAssetsCall = Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
    contractCalls.push(encodeContractCall(Address.fromString(SUSDS_TOKEN), convertToAssetsCall))
  }

  let decodedValue: BigInt = BigInt.zero()
  const response = chunkedMulticall([], contractCalls, false)
  if (_isValidResponse(response[0])) {
    decodedValue = ethereum.decode('int256', response[0]!)!.toBigInt()
    assetsUsdRate = decodedValue.toBigDecimal().div(decimals)
  }

  if (isGnosis) {
    if (_isValidResponse(response[1])) {
      decodedValue = ethereum.decode('int256', response[1]!)!.toBigInt()
      daiUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[2])) {
      decodedValue = ethereum.decode('int256', response[2]!)!.toBigInt()
      ethUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[3])) {
      decodedValue = ethereum.decode('int256', response[3]!)!.toBigInt()
      btcUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[1]) && _isValidResponse(response[4])) {
      decodedValue = ethereum.decode('int256', response[4]!)!.toBigInt()
      const sdaiDaiRate = decodedValue.toBigDecimal().div(decimals)
      sdaiUsdRate = sdaiDaiRate.times(daiUsdRate)

      // bcspx
      if (_isValidResponse(response[5])) {
        decodedValue = ethereum.decode('int256', response[5]!)!.toBigInt()
        const bcspxSdaiRate = decodedValue.toBigDecimal().div(decimals)
        bcspxUsdRate = bcspxSdaiRate.times(sdaiUsdRate).times(daiUsdRate)
      }
    }
  } else {
    if (_isValidResponse(response[1])) {
      decodedValue = ethereum.decode('int256', response[1]!)!.toBigInt()
      eurToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[2])) {
      decodedValue = ethereum.decode('int256', response[2]!)!.toBigInt()
      gbpToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[3])) {
      decodedValue = ethereum.decode('int256', response[3]!)!.toBigInt()
      cnyToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[4])) {
      decodedValue = ethereum.decode('int256', response[4]!)!.toBigInt()
      jpyToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[5])) {
      decodedValue = ethereum.decode('int256', response[5]!)!.toBigInt()
      krwToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[6])) {
      decodedValue = ethereum.decode('int256', response[6]!)!.toBigInt()
      audToUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[7])) {
      decodedValue = ethereum.decode('int256', response[7]!)!.toBigInt()
      daiUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[8])) {
      decodedValue = ethereum.decode('int256', response[8]!)!.toBigInt()
      usdcUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[9])) {
      decodedValue = ethereum.decode('int256', response[9]!)!.toBigInt()
      btcUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[10])) {
      decodedValue = ethereum.decode('int256', response[10]!)!.toBigInt()
      solUsdRate = decodedValue.toBigDecimal().div(decimals)
    }
    if (_isValidResponse(response[11]) && _isValidResponse(response[12])) {
      decodedValue = ethereum.decode('int256', response[11]!)!.toBigInt()
      usdsUsdRate = decodedValue.toBigDecimal().div(decimals)
      decodedValue = ethereum.decode('int256', response[12]!)!.toBigInt()
      const susdsUsdsRate = decodedValue.toBigDecimal().div(decimals)
      susdsUsdRate = usdsUsdRate.times(susdsUsdsRate)
    }

    // set ethUsdRate equal to assetsUsdRate on mainnet
    ethUsdRate = assetsUsdRate
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
  exchangeRate.sdaiUsdRate = sdaiUsdRate
  exchangeRate.bcspxUsdRate = bcspxUsdRate
  exchangeRate.usdcUsdRate = usdcUsdRate
  exchangeRate.save()

  const exchangeRateSnapshot = new ExchangeRateSnapshot(1)
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
    exchangeRate.bcspxUsdRate = BigDecimal.zero()
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

function _isValidResponse(response: Bytes | null): boolean {
  return response !== null && response.length > 0
}
