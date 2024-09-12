import { Address, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { GENESIS_VAULT, NETWORK, V2_REWARD_TOKEN, V2_STAKED_TOKEN, WAD } from './constants'
import { Vault } from '../../generated/schema'
import { Multicall as MulticallContract, TryAggregateCallReturnDataStruct } from '../../generated/Keeper/Multicall'

export function isGnosisNetwork(): boolean {
  return NETWORK == 'chiado' || NETWORK == 'gnosis'
}

const multicallContractAddr = Address.fromString('0xcA11bde05977b3631167028862bE2a173976CA11')
const updateStateSelector = '0x1a7ff553'
const totalAssetsSelector = '0x01e1d114'
const totalSharesSelector = '0x3a98ef39'
const convertToAssetsSelector = '0x07a2d13a'
const swapXdaiToGnoSelector = '0xb0d11302'
const poolRewardAssetsSelector = '0x18160ddd'
const poolPrincipalAssetsSelector = '0x18160ddd'
const poolPenaltyAssetsSelector = '0xe6af61c8'

export function getVaultStateUpdate(
  vault: Vault,
  rewardsRoot: Bytes,
  reward: BigInt,
  unlockedMevReward: BigInt,
  proof: Array<Bytes>,
): Array<BigInt> {
  const isGnosis = isGnosisNetwork()
  const vaultAddr = Address.fromString(vault.id)
  const updateStateCall = getUpdateStateCall(rewardsRoot, reward, unlockedMevReward, proof)
  const convertToAssetsCall = getConvertToAssetsCall(BigInt.fromString(WAD))
  const totalAssetsCall = Bytes.fromHexString(totalAssetsSelector)
  const totalSharesCall = Bytes.fromHexString(totalSharesSelector)
  const swapXdaiToGnoCall = Bytes.fromHexString(swapXdaiToGnoSelector)

  const multicallContract = MulticallContract.bind(multicallContractAddr)
  let calls: Array<ethereum.Value> = [getAggregateCall(vaultAddr, updateStateCall)]
  if (isGnosis) {
    calls.push(getAggregateCall(vaultAddr, swapXdaiToGnoCall))
  }
  calls.push(getAggregateCall(vaultAddr, convertToAssetsCall))
  calls.push(getAggregateCall(vaultAddr, totalAssetsCall))
  calls.push(getAggregateCall(vaultAddr, totalSharesCall))

  const result = multicallContract.call('tryAggregate', 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])', [
    ethereum.Value.fromBoolean(false),
    ethereum.Value.fromArray(calls),
  ])
  const resultValue = result[0].toTupleArray<TryAggregateCallReturnDataStruct>()
  if (!resultValue[0].success) {
    log.error('[Vault] getVaultStateUpdate failed for vault={} updateStateCall={}', [
      vault.id,
      updateStateCall.toHexString(),
    ])
    assert(false, 'executeVaultUpdateState failed')
  }

  let newRate: BigInt, totalAssets: BigInt, totalShares: BigInt
  if (isGnosis) {
    newRate = ethereum.decode('uint256', resultValue[2].returnData)!.toBigInt()
    totalAssets = ethereum.decode('uint256', resultValue[3].returnData)!.toBigInt()
    totalShares = ethereum.decode('uint256', resultValue[4].returnData)!.toBigInt()
  } else {
    newRate = ethereum.decode('uint256', resultValue[1].returnData)!.toBigInt()
    totalAssets = ethereum.decode('uint256', resultValue[2].returnData)!.toBigInt()
    totalShares = ethereum.decode('uint256', resultValue[3].returnData)!.toBigInt()
  }
  return [newRate, totalAssets, totalShares]
}

export function getPoolStateUpdate(
  rewardsRoot: Bytes,
  reward: BigInt,
  unlockedMevReward: BigInt,
  proof: Array<Bytes>,
): Array<BigInt> {
  const isGnosis = isGnosisNetwork()
  const rewardAssetsCall = Bytes.fromHexString(poolRewardAssetsSelector)
  const principalAssetsCall = Bytes.fromHexString(poolPrincipalAssetsSelector)
  const penaltyAssetsCall = Bytes.fromHexString(poolPenaltyAssetsSelector)
  const updateStateCall = getUpdateStateCall(rewardsRoot, reward, unlockedMevReward, proof)
  const swapXdaiToGnoCall = Bytes.fromHexString(swapXdaiToGnoSelector)

  const multicallContract = MulticallContract.bind(multicallContractAddr)
  let calls: Array<ethereum.Value> = [getAggregateCall(GENESIS_VAULT, updateStateCall)]
  if (isGnosis) {
    calls.push(getAggregateCall(GENESIS_VAULT, swapXdaiToGnoCall))
  }
  calls.push(getAggregateCall(V2_REWARD_TOKEN, rewardAssetsCall))
  calls.push(getAggregateCall(V2_REWARD_TOKEN, penaltyAssetsCall))
  calls.push(getAggregateCall(V2_STAKED_TOKEN, principalAssetsCall))

  const result = multicallContract.call('tryAggregate', 'tryAggregate(bool,(address,bytes)[]):((bool,bytes)[])', [
    ethereum.Value.fromBoolean(false),
    ethereum.Value.fromArray(calls),
  ])
  const resultValue = result[0].toTupleArray<TryAggregateCallReturnDataStruct>()
  if (!resultValue[0].success) {
    log.error('[Vault] getPoolStateUpdate failed updateStateCall={}', [updateStateCall.toHexString()])
    assert(false, 'getPoolLatestRate failed')
  }

  let rewardAssets: BigInt, principalAssets: BigInt, penaltyAssets: BigInt
  if (isGnosis) {
    rewardAssets = ethereum.decode('uint256', resultValue[2].returnData)!.toBigInt()
    penaltyAssets = ethereum.decode('uint256', resultValue[3].returnData)!.toBigInt()
    principalAssets = ethereum.decode('uint256', resultValue[4].returnData)!.toBigInt()
  } else {
    rewardAssets = ethereum.decode('uint256', resultValue[1].returnData)!.toBigInt()
    penaltyAssets = ethereum.decode('uint256', resultValue[2].returnData)!.toBigInt()
    principalAssets = ethereum.decode('uint256', resultValue[3].returnData)!.toBigInt()
  }
  let newRate = BigInt.fromString(WAD)
  if (principalAssets.gt(BigInt.fromI32(0))) {
    newRate = newRate.times(rewardAssets.plus(principalAssets).minus(penaltyAssets)).div(principalAssets)
  }

  return [newRate, rewardAssets, principalAssets, penaltyAssets]
}

function getUpdateStateCall(rewardsRoot: Bytes, reward: BigInt, unlockedMevReward: BigInt, proof: Array<Bytes>): Bytes {
  const updateStateArray: Array<ethereum.Value> = [
    ethereum.Value.fromFixedBytes(rewardsRoot),
    ethereum.Value.fromSignedBigInt(reward),
    ethereum.Value.fromUnsignedBigInt(unlockedMevReward),
    ethereum.Value.fromFixedBytesArray(proof),
  ]
  // Encode the tuple
  const encodedUpdateStateArgs = ethereum.encode(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(updateStateArray)))
  return Bytes.fromHexString(updateStateSelector).concat(encodedUpdateStateArgs as Bytes)
}

function getConvertToAssetsCall(shares: BigInt): Bytes {
  const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(shares))
  return Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs as Bytes)
}

function getAggregateCall(target: Address, data: Bytes): ethereum.Value {
  const struct: Array<ethereum.Value> = [ethereum.Value.fromAddress(target), ethereum.Value.fromBytes(data)]
  return ethereum.Value.fromTuple(changetype<ethereum.Tuple>(struct))
}
