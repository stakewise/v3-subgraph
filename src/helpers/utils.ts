import { Address, BigDecimal, Bytes, ethereum } from '@graphprotocol/graph-ts'

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

export function calculateMedian(values: Array<BigDecimal>): BigDecimal {
  if (values.length === 0) {
    return BigDecimal.zero()
  }

  // Sort the values
  const sortedValues = values.sort((a, b) => (a.lt(b) ? -1 : a.gt(b) ? 1 : 0))
  const mid = sortedValues.length / 2

  if (sortedValues.length % 2 !== 0) {
    // For odd number of elements, directly access the middle element
    return sortedValues[(mid - 0.5) as i32] // Adjusting for 0-based index
  } else {
    // For even number of elements, calculate the average of the two middle elements
    const lowerMidIndex = mid - 1
    return sortedValues[lowerMidIndex as i32].plus(sortedValues[mid as i32]).div(BigDecimal.fromString('2'))
  }
}
