import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'

export function getAggregateCall(target: Address, data: Bytes): ethereum.Value {
  const struct: Array<ethereum.Value> = [ethereum.Value.fromAddress(target), ethereum.Value.fromBytes(data)]
  return ethereum.Value.fromTuple(changetype<ethereum.Tuple>(struct))
}

export function calculateAverage(values: Array<BigDecimal>): BigDecimal {
  if (values.length === 0) {
    return BigDecimal.zero()
  }

  // Start with a sum of zero.
  let sum: BigDecimal = BigDecimal.zero()

  // Iterate over all values to calculate the sum.
  for (let i = 0; i < values.length; i++) {
    sum = sum.plus(values[i])
  }

  // Divide the sum by the number of values to get the average.
  // Note: BigDecimal division needs to handle scale/precision appropriately.
  // Here, 'values.length' is converted to a BigDecimal for division.
  return sum.div(BigDecimal.fromString(values.length.toString()))
}

export function getAnnualReward(principal: BigInt, apy: BigDecimal): BigInt {
  return principal.toBigDecimal().times(apy).div(BigDecimal.fromString('100')).truncate(0).digits
}

export function getCompoundedApy(initialApyPercent: BigDecimal, secondaryApyPercent: BigDecimal): BigDecimal {
  const hundred = BigDecimal.fromString('100')

  // convert percentages to decimal fractions
  const initialApy = initialApyPercent.div(hundred)
  const secondaryApy = secondaryApyPercent.div(hundred)

  // approximate finalAPY using linearization, works only for small APYs
  // finalApy ≈ initialApy * (1 + (secondaryApy / 2))
  const factor = BigDecimal.fromString('1').plus(secondaryApy.div(BigDecimal.fromString('2')))
  const finalApy = initialApy.times(factor)

  // convert back to a percentage if needed
  return finalApy.times(hundred)
}
