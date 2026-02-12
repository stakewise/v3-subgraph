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
  UNISWAP_FACTORY,
} from '../src/helpers/constants'

const FACTORY_ADDRESS = UNISWAP_FACTORY
const WETH_ADDRESS = Address.fromString(ASSET_TOKEN)
const RANDOM_TOKEN = Address.fromString('0x0000000000000000000000000000000000000001')
const RANDOM_POOL = Address.fromString('0x0000000000000000000000000000000000000002')
const SENDER = Address.fromString('0x0000000000000000000000000000000000000003')
const RECIPIENT = Address.fromString('0x0000000000000000000000000000000000000004')

// Pool configs: token ordering matches on-chain address sort
// SWISE (0x48c3) < WETH (0xC02a) → SWISE=token0, direct formula
// SSV   (0x9d65) < WETH (0xC02a) → SSV=token0,   direct formula
// OBOL  (0x0b01) < WETH (0xC02a) → OBOL=token0,  direct formula
// LYX   (0xC210) > WETH (0xC02a) → WETH=token0,  inverted formula
class PoolConfig {
  name: string
  token0: Address
  token1: Address
  pool: Address
  fee: i32
  tickSpacing: i32
  sqrtPrice: BigInt
  tick: i32

  constructor(
    name: string,
    token0: Address,
    token1: Address,
    pool: Address,
    fee: i32,
    tickSpacing: i32,
    sqrtPrice: BigInt,
    tick: i32,
  ) {
    this.name = name
    this.token0 = token0
    this.token1 = token1
    this.pool = pool
    this.fee = fee
    this.tickSpacing = tickSpacing
    this.sqrtPrice = sqrtPrice
    this.tick = tick
  }
}

const SWISE_POOL = new PoolConfig(
  'SWISE',
  SWISE_TOKEN as Address,
  WETH_ADDRESS,
  Address.fromString(SWISE_ASSET_UNI_POOL),
  10000,
  200,
  BigInt.fromString('181300000000000000000000000'),
  -128000,
)
const SSV_POOL = new PoolConfig(
  'SSV',
  Address.fromString(SSV_TOKEN),
  WETH_ADDRESS,
  Address.fromString(SSV_ASSET_UNI_POOL),
  3000,
  60,
  BigInt.fromString('4793000000000000000000000000'),
  -22000,
)
const OBOL_POOL = new PoolConfig(
  'OBOL',
  Address.fromString(OBOL_TOKEN),
  WETH_ADDRESS,
  Address.fromString(OBOL_ASSET_UNI_POOL),
  10000,
  200,
  BigInt.fromString('678000000000000000000000000'),
  -68000,
)
const LYX_POOL = new PoolConfig(
  'LYX',
  WETH_ADDRESS,
  Address.fromString(LYX_TOKEN),
  Address.fromString(LYX_ASSET_UNI_POOL),
  10000,
  200,
  BigInt.fromString('6248183018687580866187648848439'),
  87704,
)

const pools: PoolConfig[] = [SWISE_POOL, SSV_POOL, OBOL_POOL, LYX_POOL]

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

  // Mock each chunk dynamically, mirroring the chunkedMulticall loop in src/helpers/utils.ts
  const chunkSize = 10 // must match the default chunkSize used by updateExchangeRates
  for (let i = 0; i < allCalls.length; i += chunkSize) {
    const end = i + chunkSize < allCalls.length ? i + chunkSize : allCalls.length
    createMockedFunction(multicallAddr, 'tryAggregate', sig)
      .withArgs([ethereum.Value.fromBoolean(false), ethereum.Value.fromArray(allCalls.slice(i, end))])
      .returns([buildResultTuples(responses.slice(i, end))])
  }
}

function setupUniswapPools(): void {
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i]
    const pool = new UniswapPool(p.pool.toHexString())
    pool.token0 = p.token0
    pool.token1 = p.token1
    pool.feeTier = BigInt.fromI32(p.fee)
    pool.sqrtPrice = p.sqrtPrice
    pool.save()
  }
}

describe('exchangeRates', () => {
  afterEach(() => {
    clearStore()
  })

  describe('handlePoolCreated', () => {
    test('creates each supported pool with correct fields', () => {
      for (let i = 0; i < pools.length; i++) {
        clearStore()
        const p = pools[i]
        const event = createPoolCreatedEvent(FACTORY_ADDRESS, p.token0, p.token1, p.fee, p.tickSpacing, p.pool)
        handlePoolCreated(event)

        assert.entityCount('UniswapPool', 1)
        assert.fieldEquals('UniswapPool', p.pool.toHexString(), 'token0', p.token0.toHexString())
        assert.fieldEquals('UniswapPool', p.pool.toHexString(), 'token1', p.token1.toHexString())
        assert.fieldEquals('UniswapPool', p.pool.toHexString(), 'feeTier', p.fee.toString())
        assert.fieldEquals('UniswapPool', p.pool.toHexString(), 'sqrtPrice', '0')
      }
    })

    test('creates all 4 pools from sequential events', () => {
      for (let i = 0; i < pools.length; i++) {
        const p = pools[i]
        const event = createPoolCreatedEvent(FACTORY_ADDRESS, p.token0, p.token1, p.fee, p.tickSpacing, p.pool)
        handlePoolCreated(event)
      }
      assert.entityCount('UniswapPool', 4)
    })

    test('ignores pool when neither token is supported', () => {
      const event = createPoolCreatedEvent(FACTORY_ADDRESS, RANDOM_TOKEN, RANDOM_TOKEN, 3000, 60, RANDOM_POOL)
      handlePoolCreated(event)

      assert.entityCount('UniswapPool', 0)
    })
  })

  describe('handleSwap', () => {
    test('updates sqrtPrice and tick for each pool', () => {
      for (let i = 0; i < pools.length; i++) {
        clearStore()
        const p = pools[i]
        const createEvent = createPoolCreatedEvent(FACTORY_ADDRESS, p.token0, p.token1, p.fee, p.tickSpacing, p.pool)
        handlePoolCreated(createEvent)

        const swapEvent = createSwapEvent(
          p.pool,
          SENDER,
          RECIPIENT,
          BigInt.fromString('-500000000000000000'),
          BigInt.fromString('1000000000000000000'),
          p.sqrtPrice,
          BigInt.fromString('1000000000000000000'),
          p.tick,
        )
        handleSwap(swapEvent)

        assert.fieldEquals('UniswapPool', p.pool.toHexString(), 'sqrtPrice', p.sqrtPrice.toString())
        assert.fieldEquals('UniswapPool', p.pool.toHexString(), 'tick', p.tick.toString())
      }
    })

    test('ignores swap for unknown pool', () => {
      const swapEvent = createSwapEvent(
        RANDOM_POOL,
        SENDER,
        RECIPIENT,
        BigInt.fromString('-500000000000000000'),
        BigInt.fromString('1000000000000000000'),
        BigInt.fromString('1000000000000000000'),
        BigInt.fromString('1000000000000000000'),
        0,
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

      // --- Setup all 4 UniswapPool entities ---
      setupUniswapPools()

      // --- Mock Multicall tryAggregate ---
      // Mainnet: 12 Chainlink oracle calls + 1 sUSDS convertToAssets = 13 responses
      // All Chainlink values are int256 with 8 decimals
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
      assert.assertTrue(er.osTokenAssetsRate.gt(BigDecimal.fromString('1.049')))
      assert.assertTrue(er.osTokenAssetsRate.lt(BigDecimal.fromString('1.051')))

      // Chainlink direct rates: value / 10^8
      // assetsUsdRate = 191200000000 / 10^8 = 1912.0
      assert.assertTrue(er.assetsUsdRate.gt(BigDecimal.fromString('1911.9')))
      assert.assertTrue(er.assetsUsdRate.lt(BigDecimal.fromString('1912.1')))

      // mainnet: ethUsdRate = assetsUsdRate
      assert.assertTrue(er.ethUsdRate.equals(er.assetsUsdRate))

      // daiUsdRate = 99990000 / 10^8 = 0.9999
      assert.assertTrue(er.daiUsdRate.gt(BigDecimal.fromString('0.9998')))
      assert.assertTrue(er.daiUsdRate.lt(BigDecimal.fromString('1.0')))

      // usdcUsdRate = 99996000 / 10^8 = 0.99996
      assert.assertTrue(er.usdcUsdRate.gt(BigDecimal.fromString('0.9999')))
      assert.assertTrue(er.usdcUsdRate.lt(BigDecimal.fromString('1.0')))

      // btcUsdRate = 8511159000000 / 10^8 = 85111.59
      assert.assertTrue(er.btcUsdRate.gt(BigDecimal.fromString('85111')))
      assert.assertTrue(er.btcUsdRate.lt(BigDecimal.fromString('85112')))

      // solUsdRate = 12823000000 / 10^8 = 128.23
      assert.assertTrue(er.solUsdRate.gt(BigDecimal.fromString('128.22')))
      assert.assertTrue(er.solUsdRate.lt(BigDecimal.fromString('128.24')))

      // sUSDS rate = usdsUsdRate * sUsdsUsdsRate = 1.0 * 1.05 = 1.05
      assert.assertTrue(er.susdsUsdRate.gt(BigDecimal.fromString('1.049')))
      assert.assertTrue(er.susdsUsdRate.lt(BigDecimal.fromString('1.051')))

      // Forex inversions (1 / chainlinkRate)
      // usdToEur = 1 / 1.085 ≈ 0.9217
      assert.assertTrue(er.usdToEurRate.gt(BigDecimal.fromString('0.921')))
      assert.assertTrue(er.usdToEurRate.lt(BigDecimal.fromString('0.923')))

      // usdToGbp = 1 / 1.293 ≈ 0.7734
      assert.assertTrue(er.usdToGbpRate.gt(BigDecimal.fromString('0.773')))
      assert.assertTrue(er.usdToGbpRate.lt(BigDecimal.fromString('0.774')))

      // usdToCny = 1 / 0.137 ≈ 7.2993
      assert.assertTrue(er.usdToCnyRate.gt(BigDecimal.fromString('7.29')))
      assert.assertTrue(er.usdToCnyRate.lt(BigDecimal.fromString('7.31')))

      // usdToJpy = 1 / 0.00671 ≈ 149.03
      assert.assertTrue(er.usdToJpyRate.gt(BigDecimal.fromString('149.0')))
      assert.assertTrue(er.usdToJpyRate.lt(BigDecimal.fromString('149.1')))

      // usdToKrw = 1 / 0.00072 ≈ 1388.89
      assert.assertTrue(er.usdToKrwRate.gt(BigDecimal.fromString('1388')))
      assert.assertTrue(er.usdToKrwRate.lt(BigDecimal.fromString('1390')))

      // usdToAud = 1 / 0.635 ≈ 1.5748
      assert.assertTrue(er.usdToAudRate.gt(BigDecimal.fromString('1.574')))
      assert.assertTrue(er.usdToAudRate.lt(BigDecimal.fromString('1.576')))

      // Uniswap rates — direct formula: sqrtPrice^2 / 2^192 * assetsUsdRate
      // SWISE ≈ $0.01001
      assert.assertTrue(er.swiseUsdRate.gt(BigDecimal.fromString('0.0099')))
      assert.assertTrue(er.swiseUsdRate.lt(BigDecimal.fromString('0.0102')))

      // SSV ≈ $6.998
      assert.assertTrue(er.ssvUsdRate.gt(BigDecimal.fromString('6.99')))
      assert.assertTrue(er.ssvUsdRate.lt(BigDecimal.fromString('7.01')))

      // OBOL ≈ $0.14002
      assert.assertTrue(er.obolUsdRate.gt(BigDecimal.fromString('0.139')))
      assert.assertTrue(er.obolUsdRate.lt(BigDecimal.fromString('0.141')))

      // LYX ≈ $0.3074 — inverted formula: 1 / (sqrtPrice^2 / 2^192) * assetsUsdRate
      assert.assertTrue(er.lyxUsdRate.gt(BigDecimal.fromString('0.306')))
      assert.assertTrue(er.lyxUsdRate.lt(BigDecimal.fromString('0.309')))

      // Gnosis-only rates are zero on mainnet
      assert.assertTrue(er.sdaiUsdRate.equals(BigDecimal.zero()))
      assert.assertTrue(er.bcspxUsdRate.equals(BigDecimal.zero()))
    })
  })
})
