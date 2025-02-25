import { Address, BigInt } from '@graphprotocol/graph-ts'
import { UniswapPool, UniswapPosition } from '../../generated/schema'
import { UniswapPositionManager } from '../../generated/UniswapPositionManager/UniswapPositionManager'
import { UniswapFactory } from '../../generated/UniswapFactory/UniswapFactory'
import { OS_TOKEN, SWISE_TOKEN, SSV_TOKEN, UNISWAP_POSITION_MANAGER, UNISWAP_FACTORY } from '../helpers/constants'

export const MIN_TICK = -887272
export const MAX_TICK = -MIN_TICK
const MAX_UINT_256 = BigInt.fromString('115792089237316195423570985008687907853269984665640564039457584007913129639935')
const Q32 = BigInt.fromI32(2).pow(32)
const Q96 = BigInt.fromI32(2).pow(96)

export function isPositionSupportedToken(token: Address): boolean {
  return token.equals(OS_TOKEN) || token.equals(SWISE_TOKEN)
}

export function isPoolSupportedToken(token: Address): boolean {
  return token.equals(OS_TOKEN) || token.equals(SWISE_TOKEN) || token.equals(Address.fromString(SSV_TOKEN))
}

export function loadUniswapPool(poolAddress: Address): UniswapPool | null {
  return UniswapPool.load(poolAddress.toHexString())
}

export function createOrLoadPosition(tokenId: BigInt): UniswapPosition | null {
  let position = UniswapPosition.load(tokenId.toString())
  if (position == null) {
    let positionManager = UniswapPositionManager.bind(UNISWAP_POSITION_MANAGER)
    let positionCall = positionManager.try_positions(tokenId)
    if (positionCall.reverted) {
      // the call reverts in situations where the position is minted
      // and deleted in the same block
      return null
    }

    let positionResult = positionCall.value
    let token0 = positionResult.getToken0()
    let token1 = positionResult.getToken1()
    let hasSupportedToken = isPositionSupportedToken(token0) || isPositionSupportedToken(token1)
    if (!hasSupportedToken) {
      return null
    }

    let fee = positionResult.getFee()
    let factory = UniswapFactory.bind(UNISWAP_FACTORY)
    let poolAddress = factory.getPool(token0, token1, fee)
    if (loadUniswapPool(poolAddress) == null) {
      return null
    }

    position = new UniswapPosition(tokenId.toString())
    position.owner = Address.zero()
    position.pool = poolAddress.toHexString()
    position.amount0 = BigInt.zero()
    position.amount1 = BigInt.zero()
    position.tickLower = positionResult.getTickLower()
    position.tickUpper = positionResult.getTickUpper()
    position.liquidity = BigInt.zero()
    position.save()
  }

  return position
}

export function getAmount0(
  tickCurrent: i32,
  sqrtRatioX96: BigInt,
  tickLower: i32,
  tickUpper: i32,
  liquidity: BigInt,
): BigInt {
  if (tickCurrent < tickLower) {
    return getAmount0Delta(getSqrtRatioAtTick(tickLower), getSqrtRatioAtTick(tickUpper), liquidity, false)
  } else if (tickCurrent < tickUpper) {
    return getAmount0Delta(sqrtRatioX96, getSqrtRatioAtTick(tickUpper), liquidity, false)
  }
  return BigInt.fromI32(0)
}

export function getAmount1(
  tickCurrent: i32,
  sqrtRatioX96: BigInt,
  tickLower: i32,
  tickUpper: i32,
  liquidity: BigInt,
): BigInt {
  if (tickCurrent < tickLower) {
    return BigInt.fromI32(0)
  } else if (tickCurrent < tickUpper) {
    return getAmount1Delta(getSqrtRatioAtTick(tickLower), sqrtRatioX96, liquidity, false)
  }
  return getAmount1Delta(getSqrtRatioAtTick(tickLower), getSqrtRatioAtTick(tickUpper), liquidity, false)
}

function getAmount0Delta(sqrtRatioAX96: BigInt, sqrtRatioBX96: BigInt, liquidity: BigInt, roundUp: bool): BigInt {
  if (sqrtRatioAX96.gt(sqrtRatioBX96)) {
    let temp = sqrtRatioAX96
    sqrtRatioAX96 = sqrtRatioBX96
    sqrtRatioBX96 = temp
  }

  let numerator1 = liquidity.leftShift(96)
  let numerator2 = sqrtRatioBX96.minus(sqrtRatioAX96)

  if (roundUp) {
    return _ceilDivide(_ceilDivide(numerator1.times(numerator2), sqrtRatioBX96), sqrtRatioAX96)
  } else {
    return numerator1.times(numerator2).div(sqrtRatioBX96).div(sqrtRatioAX96)
  }
}

function getAmount1Delta(sqrtRatioAX96: BigInt, sqrtRatioBX96: BigInt, liquidity: BigInt, roundUp: bool): BigInt {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    let temp = sqrtRatioAX96
    sqrtRatioAX96 = sqrtRatioBX96
    sqrtRatioBX96 = temp
  }

  if (roundUp) {
    return _ceilDivide(liquidity.times(sqrtRatioBX96.minus(sqrtRatioAX96)), Q96)
  } else {
    return liquidity.times(sqrtRatioBX96.minus(sqrtRatioAX96)).div(Q96)
  }
}

function mulShift(val: BigInt, mulBy: string): BigInt {
  return val.times(BigInt.fromString(mulBy)).rightShift(128)
}

function _ceilDivide(a: BigInt, b: BigInt): BigInt {
  let result = a.div(b)
  if (a.mod(b).gt(BigInt.zero())) {
    result = result.plus(BigInt.fromI32(1))
  }
  return result
}

function getSqrtRatioAtTick(tick: i32): BigInt {
  if (!(MIN_TICK <= tick && tick <= MAX_TICK)) {
    assert(false, `Received invalid tick: ${tick.toString()}`)
  }

  let absTick = tick < 0 ? -tick : tick

  let ratio: BigInt
  if ((absTick & 1) != 0) {
    ratio = BigInt.fromString('340265354078544963557816517032075149313')
  } else {
    ratio = BigInt.fromString('340282366920938463463374607431768211456')
  }

  if ((absTick & 2) != 0) ratio = mulShift(ratio, '340248342086729790484326174814286782778')
  if ((absTick & 4) != 0) ratio = mulShift(ratio, '340214320654664324051920982716015181260')
  if ((absTick & 8) != 0) ratio = mulShift(ratio, '340146287995602323631171512101879684304')
  if ((absTick & 16) != 0) ratio = mulShift(ratio, '340010263488231146823593991679159461444')
  if ((absTick & 32) != 0) ratio = mulShift(ratio, '339738377640345403697157401104375502016')
  if ((absTick & 64) != 0) ratio = mulShift(ratio, '339195258003219555707034227454543997025')
  if ((absTick & 128) != 0) ratio = mulShift(ratio, '338111622100601834656805679988414885971')
  if ((absTick & 256) != 0) ratio = mulShift(ratio, '335954724994790223023589805789778977700')
  if ((absTick & 512) != 0) ratio = mulShift(ratio, '331682121138379247127172139078559817300')
  if ((absTick & 1024) != 0) ratio = mulShift(ratio, '323299236684853023288211250268160618739')
  if ((absTick & 2048) != 0) ratio = mulShift(ratio, '307163716377032989948697243942600083929')
  if ((absTick & 4096) != 0) ratio = mulShift(ratio, '277268403626896220162999269216087595045')
  if ((absTick & 8192) != 0) ratio = mulShift(ratio, '225923453940442621947126027127485391333')
  if ((absTick & 16384) != 0) ratio = mulShift(ratio, '149997214084966997727330242082538205943')
  if ((absTick & 32768) != 0) ratio = mulShift(ratio, '66119101136024775622716233608466517926')
  if ((absTick & 65536) != 0) ratio = mulShift(ratio, '12847376061809297530290974190478138313')
  if ((absTick & 131072) != 0) ratio = mulShift(ratio, '485053260817066172746253684029974020')
  if ((absTick & 262144) != 0) ratio = mulShift(ratio, '691415978906521570653435304214168')
  if ((absTick & 524288) != 0) ratio = mulShift(ratio, '1404880482679654955896180642')

  if (tick > 0) {
    ratio = MAX_UINT_256.div(ratio)
  }

  // back to Q96
  if (ratio.mod(Q32).gt(BigInt.zero())) {
    return ratio.div(Q32).plus(BigInt.fromI32(1))
  } else {
    return ratio.div(Q32)
  }
}
