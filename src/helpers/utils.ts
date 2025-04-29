import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { Vault as VaultContract } from '../../generated/Keeper/Vault'
import {
  Multicall as MulticallContract,
  TryAggregateCallReturnDataOutputStruct,
} from '../../generated/Keeper/Multicall'
import { RewardSplitter as RewardSplitterContract } from '../../generated/Keeper/RewardSplitter'
import { MULTICALL, WAD } from './constants'

const secondsInYear = '31536000'
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

export function chunkedVaultMulticall(
  vaultAddress: Address,
  updateStateCall: Bytes | null,
  calls: Array<Bytes>,
  chunkSize: i32 = 10,
): Array<Bytes> {
  const vaultContract = VaultContract.bind(vaultAddress)
  const callsCount = calls.length

  let aggregatedResults: Array<Bytes> = []
  let chunk: Array<Bytes>
  for (let i = 0; i < callsCount; i += chunkSize) {
    chunk = calls.slice(i, i + chunkSize)
    if (updateStateCall) {
      chunk = [updateStateCall as Bytes].concat(chunk)
    }
    let chunkResult = vaultContract.multicall(chunk)
    if (updateStateCall) {
      chunkResult = chunkResult.slice(1) // remove first result
    }
    // Concatenate results in order
    for (let j = 0; j < chunkResult.length; j++) {
      aggregatedResults.push(chunkResult[j])
    }
  }
  return aggregatedResults
}

export function chunkedRewardSplitterMulticall(
  rewardSplitter: Address,
  calls: Array<Bytes>,
  chunkSize: i32 = 10,
): Array<Bytes> {
  const rewardSplitterContract = RewardSplitterContract.bind(rewardSplitter)
  const callsCount = calls.length

  let aggregatedResults: Array<Bytes> = []
  let chunk: Array<Bytes>
  for (let i = 0; i < callsCount; i += chunkSize) {
    chunk = calls.slice(i, i + chunkSize)
    let chunkResult = rewardSplitterContract.multicall(chunk)
    // Concatenate results in order
    for (let j = 0; j < chunkResult.length; j++) {
      aggregatedResults.push(chunkResult[j])
    }
  }
  return aggregatedResults
}

export function chunkedMulticall(
  contractAddresses: Array<Address>,
  contractCalls: Array<Bytes>,
  requireSuccess: boolean = true,
  chunkSize: i32 = 10,
): Array<Bytes | null> {
  const callsCount = contractAddresses.length
  if (callsCount !== contractCalls.length) {
    assert(false, 'contractAddresses and calls must have the same length')
  }
  if (callsCount == 0) {
    return []
  }

  const aggregateCalls: Array<ethereum.Value> = []
  for (let i = 0; i < callsCount; i++) {
    aggregateCalls.push(_getAggregateCall(contractAddresses[i], contractCalls[i]))
  }

  const multicallContract = MulticallContract.bind(Address.fromString(MULTICALL))
  const encodedRequireSuccess = ethereum.Value.fromBoolean(requireSuccess)
  let callResults: Array<TryAggregateCallReturnDataOutputStruct> = []
  for (let i = 0; i < callsCount; i += chunkSize) {
    const chunkCalls = aggregateCalls.slice(i, i + chunkSize)
    const chunkResult = multicallContract
      .call('tryAggregate', 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])', [
        encodedRequireSuccess,
        ethereum.Value.fromArray(chunkCalls),
      ])[0]
      .toTupleArray<TryAggregateCallReturnDataOutputStruct>()
    callResults = callResults.concat(chunkResult)
  }

  const results: Array<Bytes | null> = []
  for (let i = 0; i < callsCount; i++) {
    const callResult = callResults[i]
    results.push(callResult.success ? callResult.returnData : null)
  }
  return results
}

export function _getAggregateCall(target: Address, data: Bytes): ethereum.Value {
  const struct: Array<ethereum.Value> = [ethereum.Value.fromAddress(target), ethereum.Value.fromBytes(data)]
  return ethereum.Value.fromTuple(changetype<ethereum.Tuple>(struct))
}

export function rayMul(a: BigInt, b: BigInt): BigInt {
  return a.times(b).plus(halfRAY).div(RAY)
}
