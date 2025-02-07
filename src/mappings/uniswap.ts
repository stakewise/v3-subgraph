import { BigInt, log } from '@graphprotocol/graph-ts'
import { UniswapPool, UniswapPosition } from '../../generated/schema'
import { PoolCreated } from '../../generated/UniswapFactory/UniswapFactory'
import { UniswapPool as UniswapPoolTemplate } from '../../generated/templates'
import { Burn, Initialize, Mint, Swap } from '../../generated/templates/UniswapPool/UniswapPool'
import {
  DecreaseLiquidity,
  IncreaseLiquidity,
  Transfer,
} from '../../generated/UniswapPositionManager/UniswapPositionManager'
import { createOrLoadPosition, getAmount0, getAmount1, isSupportedToken, loadUniswapPool } from '../entities/uniswap'
import { SSV_ASSET_UNI_POOL } from '../helpers/constants'

export function handlePoolCreated(event: PoolCreated): void {
  let hasSupportedToken = isSupportedToken(event.params.token0) || isSupportedToken(event.params.token1)
  if (!hasSupportedToken) {
    return
  }

  let pool = new UniswapPool(event.params.pool.toHexString())

  pool.token0 = event.params.token0
  pool.token1 = event.params.token1
  pool.feeTier = BigInt.fromI32(event.params.fee)
  pool.liquidity = BigInt.zero()
  pool.sqrtPrice = BigInt.zero()
  pool.feesToken0 = BigInt.zero()
  pool.feesToken1 = BigInt.zero()
  pool.volumeToken0 = BigInt.zero()
  pool.volumeToken1 = BigInt.zero()
  pool.save()

  // create the tracked contract based on the template
  UniswapPoolTemplate.create(event.params.pool)

  log.info('[UniswapFactory] PoolCreated pool={} token0={} token1={} fee={}', [
    pool.id,
    pool.token0.toHexString(),
    pool.token1.toHexString(),
    pool.feeTier.toString(),
  ])
}

export function handleInitialize(event: Initialize): void {
  let pool = loadUniswapPool(event.address)
  if (pool == null) {
    return
  }

  pool.sqrtPrice = event.params.sqrtPriceX96
  pool.tick = event.params.tick
  pool.save()

  log.info('[UniswapPool] Initialize pool={} sqrtPrice={} tick={}', [
    pool.id,
    pool.sqrtPrice.toString(),
    pool.tick.toString(),
  ])
}

export function handleMint(event: Mint): void {
  let pool = loadUniswapPool(event.address)
  if (pool == null) {
    return
  }

  // Pools liquidity tracks the currently active liquidity given pools current tick.
  // We only want to update it on mint if the new position includes the current tick.
  let tickLower = event.params.tickLower
  let tickUpper = event.params.tickUpper
  if (pool.tick && tickLower <= pool.tick && tickUpper > pool.tick) {
    pool.liquidity = pool.liquidity.plus(event.params.amount)
    pool.save()
  }

  log.info('[UniswapPool] Mint pool={} tickLower={} tickUpper={} amount={}', [
    pool.id,
    tickLower.toString(),
    tickUpper.toString(),
    event.params.amount.toString(),
  ])
}

export function handleBurn(event: Burn): void {
  let pool = loadUniswapPool(event.address)
  if (pool == null) {
    return
  }

  // Pools liquidity tracks the currently active liquidity given pools current tick.
  // We only want to update it on burn if the position being burnt includes the current tick.
  let tickLower = event.params.tickLower
  let tickUpper = event.params.tickUpper
  if (tickLower <= pool.tick && tickUpper > pool.tick) {
    pool.liquidity = pool.liquidity.minus(event.params.amount)
    pool.save()
  }

  log.info('[UniswapPool] Burn pool={} tickLower={} tickUpper={} amount={}', [
    pool.id,
    tickLower.toString(),
    tickUpper.toString(),
    event.params.amount.toString(),
  ])
}

export function handleSwap(event: Swap): void {
  let pool = loadUniswapPool(event.address)
  if (pool == null) {
    return
  }

  // need absolute amounts for volume
  let amount0Abs = event.params.amount0
  if (event.params.amount0.lt(BigInt.zero())) {
    amount0Abs = event.params.amount0.times(BigInt.fromString('-1'))
    pool.feesToken0 = pool.feesToken0.plus(amount0Abs.times(pool.feeTier).div(BigInt.fromI32(1000000)))
  }

  let amount1Abs = event.params.amount1
  if (event.params.amount1.lt(BigInt.zero())) {
    amount1Abs = event.params.amount1.times(BigInt.fromString('-1'))
    pool.feesToken1 = pool.feesToken1.plus(amount1Abs.times(pool.feeTier).div(BigInt.fromI32(1000000)))
  }

  // pool volume
  pool.volumeToken0 = pool.volumeToken0.plus(amount0Abs)
  pool.volumeToken1 = pool.volumeToken1.plus(amount1Abs)

  // Update the pool with the new active liquidity, price, and tick.
  pool.liquidity = event.params.liquidity
  pool.tick = event.params.tick
  pool.sqrtPrice = event.params.sqrtPriceX96
  pool.save()

  if (pool.id != SSV_ASSET_UNI_POOL) {
    let position: UniswapPosition
    let positions: Array<UniswapPosition> = pool.positions.load()
    for (let i = 0; i < positions.length; i++) {
      position = positions[i]
      position.amount0 = getAmount0(
        pool.tick,
        pool.sqrtPrice,
        position.tickLower,
        position.tickUpper,
        position.liquidity,
      )
      position.amount1 = getAmount1(
        pool.tick,
        pool.sqrtPrice,
        position.tickLower,
        position.tickUpper,
        position.liquidity,
      )
      position.save()
    }
  }

  log.info('[UniswapPool] Swap pool={} amount0={} amount1={}', [
    pool.id,
    event.params.amount0.toString(),
    event.params.amount1.toString(),
  ])
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  let position = createOrLoadPosition(event.params.tokenId)

  // position could not be fetched or is not supported
  if (position == null) {
    return
  }

  position.liquidity = position.liquidity.plus(event.params.liquidity)
  position.amount0 = position.amount0.plus(event.params.amount0)
  position.amount1 = position.amount1.plus(event.params.amount1)
  position.save()

  log.info('[UniswapPositionManager] IncreaseLiquidity position={} liquidity={}', [
    position.id,
    event.params.liquidity.toString(),
  ])
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  // position is not supported
  const position = UniswapPosition.load(event.params.tokenId.toString())
  if (position == null) {
    return
  }

  position.liquidity = position.liquidity.minus(event.params.liquidity)
  position.amount0 = position.amount0.minus(event.params.amount0)
  position.amount1 = position.amount1.minus(event.params.amount1)
  position.save()

  log.info('[UniswapPositionManager] DecreaseLiquidity position={} liquidity={}', [
    position.id,
    event.params.liquidity.toString(),
  ])
}

export function handleTransfer(event: Transfer): void {
  let position = createOrLoadPosition(event.params.tokenId)

  // position could not be fetched or is not supported
  if (position == null) {
    return
  }

  position.owner = event.params.to
  position.save()

  log.info('[UniswapPositionManager] Transfer position={} from={} to={}', [
    position.id,
    event.params.from.toHexString(),
    event.params.to.toHexString(),
  ])
}
