import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  Multicall as MulticallContract,
  TryAggregateCallReturnDataOutputStruct,
} from '../../generated/Keeper/Multicall'
import { Vault } from '../../generated/schema'
import { MULTICALL, NETWORK, WAD } from './constants'

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

export function parseIpfsHash(ipfsHash: string): string | null {
  const _hash = ipfsHash.trim()
  if (_hash.length !== 46 && _hash.length !== 52) {
    return null
  }
  return _hash
}

export function isFailedUpdateStateCall(vault: Vault): boolean {
  if (NETWORK != 'chiado') {
    return false
  }

  const vaultAddress = Address.fromString(vault.id)
  const failedRoot1 = Bytes.fromHexString('0x1bc15917c998a8525f976ac59c536f3344d8b8bb1ad63da76820476fd7a7d562')
  const failedVault1 = Address.fromString('0xC54d33dE49870742B382D506566Edc81a2AbeD9D')
  const failedRoot2 = Bytes.fromHexString('0x950d6ab616a8494f139357f930ce9a430c15522365ce2e5d94f6e532a3796763')
  const failedVault2 = Address.fromString('0xF82f6E46d0d0a9536b9CA4bc480372EeaFcd9E6c')

  if (!vault.rewardsRoot) {
    return false
  }
  if (
    (vault.rewardsRoot!.equals(failedRoot1) && vaultAddress.equals(failedVault1)) ||
    (vault.rewardsRoot!.equals(failedRoot2) && vaultAddress.equals(failedVault2))
  ) {
    log.error('[isFailedUpdateStateCall] vault={} has a known failed updateState call', [vault.id])
    return true
  }
  return false
}
