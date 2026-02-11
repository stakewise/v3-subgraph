import { describe, test, afterEach, assert, clearStore, createMockedFunction } from 'matchstick-as'
import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ExchangeRate, OsToken, UniswapPool } from '../generated/schema'

import { handlePoolCreated, handleSwap } from '../src/mappings/uniswap'
import { updateExchangeRates, createOrLoadExchangeRate } from '../src/entities/exchangeRates'
import { createPoolCreatedEvent, createSwapEvent } from './util/events'
import {
  MULTICALL,
  ASSET_TOKEN,
  LYX_TOKEN,
  LYX_ASSET_UNI_POOL,
  SWISE_ASSET_UNI_POOL,
  SSV_ASSET_UNI_POOL,
  OBOL_ASSET_UNI_POOL,
  SWISE_TOKEN,
  SSV_TOKEN,
  OBOL_TOKEN,
  ASSETS_USD_PRICE_FEED,
  EUR_USD_PRICE_FEED,
  GBP_USD_PRICE_FEED,
  CNY_USD_PRICE_FEED,
  JPY_USD_PRICE_FEED,
  KRW_USD_PRICE_FEED,
  AUD_USD_PRICE_FEED,
  DAI_USD_PRICE_FEED,
  USDC_USD_PRICE_FEED,
  BTC_USD_PRICE_FEED,
  SOL_USD_PRICE_FEED,
  USDS_USD_PRICE_FEED,
  SUSDS_TOKEN,
} from '../src/helpers/constants'

// Real swap data from LYX/WETH pool
const LYX_SQRT_PRICE_X96 = BigInt.fromString('6248183018687580866187648848439')

// On-chain: WETH (0xC02a...) < LYX (0xC210...) so WETH=token0, LYX=token1
const LYX_ADDRESS = Address.fromString(LYX_TOKEN)
const WETH_ADDRESS = Address.fromString(ASSET_TOKEN)
const POOL_ADDRESS = Address.fromString(LYX_ASSET_UNI_POOL)
const FACTORY_ADDRESS = Address.fromString('0x1F98431c8aD98523631AE4a59f267346ea31F984')
const RANDOM_TOKEN = Address.fromString('0x0000000000000000000000000000000000000001')
const RANDOM_POOL = Address.fromString('0x0000000000000000000000000000000000000002')
const SENDER = Address.fromString('0x0000000000000000000000000000000000000003')
const RECIPIENT = Address.fromString('0x0000000000000000000000000000000000000004')

// Mirrors src/helpers/utils.ts encodeContractCall
function encodeCall(target: Address, data: Bytes): ethereum.Value {
  return ethereum.Value.fromTuple(
    changetype<ethereum.Tuple>([ethereum.Value.fromAddress(target), ethereum.Value.fromBytes(data)]),
  )
}

function buildResultTuples(responses: BigInt[]): ethereum.Value {
  const tuples: Array<ethereum.Value> = []
  for (let i = 0; i < responses.length; i++) {
    const encoded = ethereum.encode(ethereum.Value.fromSignedBigInt(responses[i]))!
    tuples.push(
      ethereum.Value.fromTuple(
        changetype<ethereum.Tuple>([ethereum.Value.fromBoolean(true), ethereum.Value.fromBytes(encoded)]),
      ),
    )
  }
  return ethereum.Value.fromArray(tuples)
}

function mockMulticallResponses(responses: BigInt[]): void {
  const multicallAddr = Address.fromString(MULTICALL)
  const sig = 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])'

  // Build the exact same calldata that updateExchangeRates constructs
  const latestAnswerCall = Bytes.fromHexString('0x50d25bcd')
  const decimalsInt = BigInt.fromString('100000000')
  const encodedArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(decimalsInt))!
  const convertToAssetsCall = Bytes.fromHexString('0x07a2d13a').concat(encodedArgs)

  // All 13 contract calls matching updateExchangeRates mainnet path
  const allCalls: Array<ethereum.Value> = [
    encodeCall(Address.fromString(ASSETS_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(EUR_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(GBP_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(CNY_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(JPY_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(KRW_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(AUD_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(DAI_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(USDC_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(BTC_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(SOL_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(USDS_USD_PRICE_FEED), latestAnswerCall),
    encodeCall(Address.fromString(SUSDS_TOKEN), convertToAssetsCall),
  ]

  // chunkedMulticall uses chunkSize=10, so: chunk1=[0..9], chunk2=[10..12]
  createMockedFunction(multicallAddr, 'tryAggregate', sig)
    .withArgs([ethereum.Value.fromBoolean(false), ethereum.Value.fromArray(allCalls.slice(0, 10))])
    .returns([buildResultTuples(responses.slice(0, 10))])

  createMockedFunction(multicallAddr, 'tryAggregate', sig)
    .withArgs([ethereum.Value.fromBoolean(false), ethereum.Value.fromArray(allCalls.slice(10, 13))])
    .returns([buildResultTuples(responses.slice(10, 13))])
}

describe('lyxUsdRate', () => {
  afterEach(() => {
    clearStore()
  })

  describe('handlePoolCreated', () => {
    test('creates UniswapPool entity for LYX/WETH pool', () => {
      const event = createPoolCreatedEvent(FACTORY_ADDRESS, WETH_ADDRESS, LYX_ADDRESS, 10000, 200, POOL_ADDRESS)
      handlePoolCreated(event)

      assert.entityCount('UniswapPool', 1)
      assert.fieldEquals('UniswapPool', POOL_ADDRESS.toHexString(), 'token0', WETH_ADDRESS.toHexString())
      assert.fieldEquals('UniswapPool', POOL_ADDRESS.toHexString(), 'token1', LYX_ADDRESS.toHexString())
      assert.fieldEquals('UniswapPool', POOL_ADDRESS.toHexString(), 'feeTier', '10000')
      assert.fieldEquals('UniswapPool', POOL_ADDRESS.toHexString(), 'sqrtPrice', '0')
    })

    test('ignores pool when neither token is supported', () => {
      const event = createPoolCreatedEvent(FACTORY_ADDRESS, RANDOM_TOKEN, RANDOM_TOKEN, 3000, 60, RANDOM_POOL)
      handlePoolCreated(event)

      assert.entityCount('UniswapPool', 0)
    })
  })

  describe('handleSwap', () => {
    test('updates sqrtPrice and tick on swap', () => {
      const createEvent = createPoolCreatedEvent(FACTORY_ADDRESS, WETH_ADDRESS, LYX_ADDRESS, 10000, 200, POOL_ADDRESS)
      handlePoolCreated(createEvent)

      const swapEvent = createSwapEvent(
        POOL_ADDRESS,
        SENDER,
        RECIPIENT,
        BigInt.fromString('-153959131019660405'),
        BigInt.fromString('1000000000000000000000'),
        LYX_SQRT_PRICE_X96,
        BigInt.fromString('9607513283917780802323'),
        87704,
      )
      handleSwap(swapEvent)

      assert.fieldEquals('UniswapPool', POOL_ADDRESS.toHexString(), 'sqrtPrice', LYX_SQRT_PRICE_X96.toString())
      assert.fieldEquals('UniswapPool', POOL_ADDRESS.toHexString(), 'tick', '87704')
    })

    test('ignores swap for unknown pool', () => {
      const swapEvent = createSwapEvent(
        RANDOM_POOL,
        SENDER,
        RECIPIENT,
        BigInt.fromString('-153959131019660405'),
        BigInt.fromString('1000000000000000000000'),
        LYX_SQRT_PRICE_X96,
        BigInt.fromString('9607513283917780802323'),
        87704,
      )
      handleSwap(swapEvent)

      assert.entityCount('UniswapPool', 0)
    })
  })

  describe('updateExchangeRates', () => {
    test('computes all exchange rates correctly', () => {
      // --- Setup OsToken ---
      const osToken = new OsToken('1')
      osToken.apy = BigDecimal.zero()
      osToken.apys = []
      osToken.feePercent = 0
      osToken.totalSupply = BigInt.fromString('1000000000000000000')
      osToken.totalAssets = BigInt.fromString('1050000000000000000')
      osToken.save()

      // --- Setup UniswapPool entities ---

      // SWISE pool (SWISE < WETH by address, SWISE=token0)
      const swisePool = new UniswapPool(Address.fromString(SWISE_ASSET_UNI_POOL).toHex())
      swisePool.token0 = SWISE_TOKEN
      swisePool.token1 = Address.fromString(ASSET_TOKEN)
      swisePool.feeTier = BigInt.fromI32(10000)
      swisePool.sqrtPrice = BigInt.fromString('181300000000000000000000000') // ~$0.01
      swisePool.save()

      // SSV pool (SSV < WETH by address, SSV=token0)
      const ssvPool = new UniswapPool(Address.fromString(SSV_ASSET_UNI_POOL).toHex())
      ssvPool.token0 = Address.fromString(SSV_TOKEN)
      ssvPool.token1 = Address.fromString(ASSET_TOKEN)
      ssvPool.feeTier = BigInt.fromI32(3000)
      ssvPool.sqrtPrice = BigInt.fromString('4793000000000000000000000000') // ~$7
      ssvPool.save()

      // OBOL pool (OBOL < WETH by address, OBOL=token0)
      const obolPool = new UniswapPool(Address.fromString(OBOL_ASSET_UNI_POOL).toHex())
      obolPool.token0 = Address.fromString(OBOL_TOKEN)
      obolPool.token1 = Address.fromString(ASSET_TOKEN)
      obolPool.feeTier = BigInt.fromI32(10000)
      obolPool.sqrtPrice = BigInt.fromString('678000000000000000000000000') // ~$0.14
      obolPool.save()

      // LYX pool (WETH < LYX by address, WETH=token0 → inverted formula)
      const lyxPool = new UniswapPool(Address.fromString(LYX_ASSET_UNI_POOL).toHex())
      lyxPool.token0 = Address.fromString(ASSET_TOKEN)
      lyxPool.token1 = Address.fromString(LYX_TOKEN)
      lyxPool.feeTier = BigInt.fromI32(10000)
      lyxPool.sqrtPrice = LYX_SQRT_PRICE_X96
      lyxPool.save()

      // --- Mock Multicall tryAggregate ---
      // Mainnet: 12 Chainlink oracle calls + 1 sUSDS convertToAssets = 13 responses
      // All values are int256 with 8 decimals (Chainlink standard)
      mockMulticallResponses([
        BigInt.fromString('191200000000'), //  [0] ETH/USD    = $1912
        BigInt.fromString('108500000'), //     [1] EUR/USD    = 1.085
        BigInt.fromString('129300000'), //     [2] GBP/USD    = 1.293
        BigInt.fromString('13700000'), //      [3] CNY/USD    = 0.137
        BigInt.fromString('671000'), //        [4] JPY/USD    = 0.00671
        BigInt.fromString('72000'), //         [5] KRW/USD    = 0.00072
        BigInt.fromString('63500000'), //      [6] AUD/USD    = 0.635
        BigInt.fromString('99990000'), //      [7] DAI/USD    = 0.9999
        BigInt.fromString('99996000'), //      [8] USDC/USD   = 0.99996
        BigInt.fromString('8511159000000'), // [9] BTC/USD    = $85111.59
        BigInt.fromString('12823000000'), //   [10] SOL/USD   = $128.23
        BigInt.fromString('100000000'), //     [11] USDS/USD  = 1.0
        BigInt.fromString('105000000'), //     [12] sUSDS convertToAssets = 1.05
      ])

      // --- Execute ---
      const exchangeRate = createOrLoadExchangeRate()
      updateExchangeRates(exchangeRate, BigInt.fromI32(1700000000))

      // --- Assert all rates ---
      const er = ExchangeRate.load('0')!

      // osTokenAssetsRate = totalAssets / totalSupply = 1.05
      assert.assertTrue(er.osTokenAssetsRate.gt(BigDecimal.fromString('1.04')))
      assert.assertTrue(er.osTokenAssetsRate.lt(BigDecimal.fromString('1.06')))

      // Chainlink direct rates
      assert.assertTrue(er.assetsUsdRate.gt(BigDecimal.fromString('1911')))
      assert.assertTrue(er.assetsUsdRate.lt(BigDecimal.fromString('1913')))

      // mainnet: ethUsdRate = assetsUsdRate
      assert.assertTrue(er.ethUsdRate.equals(er.assetsUsdRate))

      assert.assertTrue(er.daiUsdRate.gt(BigDecimal.fromString('0.999')))
      assert.assertTrue(er.daiUsdRate.lt(BigDecimal.fromString('1.001')))

      assert.assertTrue(er.usdcUsdRate.gt(BigDecimal.fromString('0.999')))
      assert.assertTrue(er.usdcUsdRate.lt(BigDecimal.fromString('1.001')))

      assert.assertTrue(er.btcUsdRate.gt(BigDecimal.fromString('85000')))
      assert.assertTrue(er.btcUsdRate.lt(BigDecimal.fromString('85200')))

      assert.assertTrue(er.solUsdRate.gt(BigDecimal.fromString('128')))
      assert.assertTrue(er.solUsdRate.lt(BigDecimal.fromString('129')))

      // sUSDS rate = usdsUsdRate * sUsdsUsdsRate = 1.0 * 1.05 = 1.05
      assert.assertTrue(er.susdsUsdRate.gt(BigDecimal.fromString('1.04')))
      assert.assertTrue(er.susdsUsdRate.lt(BigDecimal.fromString('1.06')))

      // Forex inversions (1 / chainlinkRate)
      // usdToEurRate = 1 / 1.085 ≈ 0.9217
      assert.assertTrue(er.usdToEurRate.gt(BigDecimal.fromString('0.9')))
      assert.assertTrue(er.usdToEurRate.lt(BigDecimal.fromString('0.95')))

      // usdToGbpRate = 1 / 1.293 ≈ 0.7734
      assert.assertTrue(er.usdToGbpRate.gt(BigDecimal.fromString('0.75')))
      assert.assertTrue(er.usdToGbpRate.lt(BigDecimal.fromString('0.8')))

      // usdToCnyRate = 1 / 0.137 ≈ 7.30
      assert.assertTrue(er.usdToCnyRate.gt(BigDecimal.fromString('7')))
      assert.assertTrue(er.usdToCnyRate.lt(BigDecimal.fromString('7.5')))

      // usdToJpyRate = 1 / 0.00671 ≈ 149.03
      assert.assertTrue(er.usdToJpyRate.gt(BigDecimal.fromString('148')))
      assert.assertTrue(er.usdToJpyRate.lt(BigDecimal.fromString('150')))

      // usdToKrwRate = 1 / 0.00072 ≈ 1388.89
      assert.assertTrue(er.usdToKrwRate.gt(BigDecimal.fromString('1380')))
      assert.assertTrue(er.usdToKrwRate.lt(BigDecimal.fromString('1400')))

      // usdToAudRate = 1 / 0.635 ≈ 1.5748
      assert.assertTrue(er.usdToAudRate.gt(BigDecimal.fromString('1.55')))
      assert.assertTrue(er.usdToAudRate.lt(BigDecimal.fromString('1.6')))

      // Uniswap rates (direct formula: sqrtPrice^2 / 2^192 * assetsUsdRate)
      // SWISE ≈ $0.01
      assert.assertTrue(er.swiseUsdRate.gt(BigDecimal.fromString('0.005')))
      assert.assertTrue(er.swiseUsdRate.lt(BigDecimal.fromString('0.02')))

      // SSV ≈ $7
      assert.assertTrue(er.ssvUsdRate.gt(BigDecimal.fromString('5')))
      assert.assertTrue(er.ssvUsdRate.lt(BigDecimal.fromString('10')))

      // OBOL ≈ $0.14
      assert.assertTrue(er.obolUsdRate.gt(BigDecimal.fromString('0.1')))
      assert.assertTrue(er.obolUsdRate.lt(BigDecimal.fromString('0.2')))

      // LYX ≈ $0.307 (inverted formula: 1 / (sqrtPrice^2 / 2^192) * assetsUsdRate)
      assert.assertTrue(er.lyxUsdRate.gt(BigDecimal.fromString('0.28')))
      assert.assertTrue(er.lyxUsdRate.lt(BigDecimal.fromString('0.35')))

      // Gnosis-only rates are zero on mainnet
      assert.assertTrue(er.sdaiUsdRate.equals(BigDecimal.zero()))
      assert.assertTrue(er.bcspxUsdRate.equals(BigDecimal.zero()))
    })
  })
})
