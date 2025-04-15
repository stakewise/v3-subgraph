import { BigDecimal, BigInt, Address } from '@graphprotocol/graph-ts'

import { PoolBalanceChanged, PoolBalanceManaged } from '../../generated/BalancerPool/BalancerPool'
import { createOrLoadBalancerPoolToken } from '../entities/balancerPool'

const tokenAddresses: string[] = [
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38',
]

export function handleBalanceChange(event: PoolBalanceChanged): void {
  const amounts: BigInt[] = event.params.deltas

  if (amounts.length === 0) {
    return
  }

  const total: BigInt = amounts.reduce<BigInt>((sum, amount) => sum.plus(amount), BigInt.zero())

  if (total.gt(BigInt.zero())) {
    handlePoolJoined(event)
  } else {
    handlePoolExited(event)
  }
}

function tokenToDecimal(amount: BigInt): BigDecimal {
  const scale = BigInt.fromI32(10).pow(18).toBigDecimal()

  return amount.toBigDecimal().div(scale)
}

function handlePoolJoined(event: PoolBalanceChanged): void {
  const amounts: BigInt[] = event.params.deltas
  const protocolFeeAmounts: BigInt[] = event.params.protocolFeeAmounts

  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    const poolToken = createOrLoadBalancerPoolToken(tokenAddresses[i])
    const amountIn = amounts[i].minus(protocolFeeAmounts[i])
    const tokenAmountIn = tokenToDecimal(amountIn)

    poolToken.balance = poolToken.balance.plus(tokenAmountIn)
    poolToken.save()
  }
}

function handlePoolExited(event: PoolBalanceChanged): void {
  const amounts: BigInt[] = event.params.deltas
  const protocolFeeAmounts: BigInt[] = event.params.protocolFeeAmounts

  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    const poolToken = createOrLoadBalancerPoolToken(tokenAddresses[i])
    const amountOut = amounts[i].minus(protocolFeeAmounts[i]).neg()
    const tokenAmountOut = tokenToDecimal(amountOut)

    poolToken.balance = poolToken.balance.minus(tokenAmountOut)
    poolToken.save()
  }
}

export function handleBalanceManage(event: PoolBalanceManaged): void {
  const cashDelta = event.params.cashDelta
  const managedDelta = event.params.managedDelta
  const tokenAddress: Address = event.params.token
  const poolToken = createOrLoadBalancerPoolToken(tokenAddress.toHex())

  const cashDeltaAmount = tokenToDecimal(cashDelta)
  const managedDeltaAmount = tokenToDecimal(managedDelta)
  const deltaAmount = cashDeltaAmount.plus(managedDeltaAmount)

  poolToken.balance = poolToken.balance.plus(deltaAmount)
  poolToken.save()
}
