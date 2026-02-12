import { newMockEvent } from 'matchstick-as'
import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'

import { PoolCreated } from '../../generated/UniswapFactory/UniswapFactory'
import { Swap } from '../../generated/templates/UniswapPool/UniswapPool'

export function createPoolCreatedEvent(
  factoryAddress: Address,
  token0: Address,
  token1: Address,
  fee: i32,
  tickSpacing: i32,
  pool: Address,
): PoolCreated {
  const mockEvent = newMockEvent()

  const event = new PoolCreated(
    factoryAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null,
  )

  event.parameters = []

  event.parameters.push(new ethereum.EventParam('token0', ethereum.Value.fromAddress(token0)))
  event.parameters.push(new ethereum.EventParam('token1', ethereum.Value.fromAddress(token1)))
  event.parameters.push(new ethereum.EventParam('fee', ethereum.Value.fromI32(fee)))
  event.parameters.push(new ethereum.EventParam('tickSpacing', ethereum.Value.fromI32(tickSpacing)))
  event.parameters.push(new ethereum.EventParam('pool', ethereum.Value.fromAddress(pool)))

  return event
}

export function createSwapEvent(
  poolAddress: Address,
  sender: Address,
  recipient: Address,
  amount0: BigInt,
  amount1: BigInt,
  sqrtPriceX96: BigInt,
  liquidity: BigInt,
  tick: i32,
): Swap {
  const mockEvent = newMockEvent()

  const event = new Swap(
    poolAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    null,
  )

  event.parameters = []

  event.parameters.push(new ethereum.EventParam('sender', ethereum.Value.fromAddress(sender)))
  event.parameters.push(new ethereum.EventParam('recipient', ethereum.Value.fromAddress(recipient)))
  event.parameters.push(new ethereum.EventParam('amount0', ethereum.Value.fromSignedBigInt(amount0)))
  event.parameters.push(new ethereum.EventParam('amount1', ethereum.Value.fromSignedBigInt(amount1)))
  event.parameters.push(new ethereum.EventParam('sqrtPriceX96', ethereum.Value.fromUnsignedBigInt(sqrtPriceX96)))
  event.parameters.push(new ethereum.EventParam('liquidity', ethereum.Value.fromUnsignedBigInt(liquidity)))
  event.parameters.push(new ethereum.EventParam('tick', ethereum.Value.fromI32(tick)))

  return event
}
