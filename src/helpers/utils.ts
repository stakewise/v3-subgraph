import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  Multicall as MulticallContract,
  TryAggregateCallReturnDataOutputStruct,
} from '../../generated/Keeper/Multicall'
import { MULTICALL, NETWORK, WAD } from './constants'

const secondsInYear = '31536000'
const secondsInDay = 86400
const maxPercent = '100'
const wei = BigDecimal.fromString('1').div(BigDecimal.fromString(WAD))
const RAY = BigInt.fromI32(10).pow(27)
const halfRAY = RAY.div(BigInt.fromI32(2))

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
  if (principal.isZero() || apy.equals(BigDecimal.zero())) {
    return BigInt.zero()
  }
  // FIXME: Add 0.000000000000000001 to the APY as there is an issue with BigDecimal numbers
  // For example, apy = 3.741797575044 principal = 1000000000000000000, but the result is 3741797575044 instead of 3741797575044000000.
  return principal.toBigDecimal().times(apy.plus(wei)).div(BigDecimal.fromString('100')).truncate(0).digits
}

export function calculateApy(earnedAssets: BigInt, totalAssets: BigInt, durationInSeconds: BigInt): BigDecimal {
  if (durationInSeconds.le(BigInt.zero()) || totalAssets.le(BigInt.zero())) {
    return BigDecimal.zero()
  }
  return earnedAssets
    .toBigDecimal()
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(totalAssets.toBigDecimal())
    .div(durationInSeconds.toBigDecimal())
}

export function chunkedMulticall(
  updateStateCall: ethereum.Value | null,
  contractCalls: Array<ethereum.Value>,
  requireSuccess: boolean = true,
  chunkSize: i32 = 10,
): Array<Bytes | null> {
  const callsCount = contractCalls.length
  if (callsCount == 0) {
    return []
  }
  const multicallContract = MulticallContract.bind(Address.fromString(MULTICALL))
  const encodedRequireSuccess = ethereum.Value.fromBoolean(requireSuccess)

  let callResults: Array<TryAggregateCallReturnDataOutputStruct> = []
  const updateStateCalls: Array<ethereum.Value> = updateStateCall ? [updateStateCall] : []
  const updateStateCallsCount = updateStateCalls.length
  for (let i = 0; i < callsCount; i += chunkSize) {
    const chunkCalls = contractCalls.slice(i, i + chunkSize)
    const chunkResult = multicallContract
      .call('tryAggregate', 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])', [
        encodedRequireSuccess,
        ethereum.Value.fromArray(updateStateCalls.concat(chunkCalls)),
      ])[0]
      .toTupleArray<TryAggregateCallReturnDataOutputStruct>()
    callResults = callResults.concat(chunkResult.slice(updateStateCallsCount))
  }

  const results: Array<Bytes | null> = []
  for (let i = 0; i < callsCount; i++) {
    const callResult = callResults[i]
    results.push(callResult.success ? callResult.returnData : null)
  }
  return results
}

export function encodeContractCall(target: Address, data: Bytes): ethereum.Value {
  const struct: Array<ethereum.Value> = [ethereum.Value.fromAddress(target), ethereum.Value.fromBytes(data)]
  return ethereum.Value.fromTuple(changetype<ethereum.Tuple>(struct))
}

export function rayMul(a: BigInt, b: BigInt): BigInt {
  return a.times(b).plus(halfRAY).div(RAY)
}

export function isFailedRewardsUpdate(rewardsRoot: Bytes | null): boolean {
  if (NETWORK != 'chiado' || rewardsRoot === null) {
    return false
  }

  const failedRoot1 = Bytes.fromHexString('0x1bc15917c998a8525f976ac59c536f3344d8b8bb1ad63da76820476fd7a7d562')
  const failedRoot2 = Bytes.fromHexString('0x950d6ab616a8494f139357f930ce9a430c15522365ce2e5d94f6e532a3796763')
  return rewardsRoot.equals(failedRoot1) || rewardsRoot.equals(failedRoot2)
}

export function getSnapshotTimestamp(timestamp: i64): i64 {
  const remainder = timestamp % secondsInDay
  if (remainder > 0) {
    timestamp -= remainder
  }
  // convert to microseconds
  return timestamp * 1_000_000
}
