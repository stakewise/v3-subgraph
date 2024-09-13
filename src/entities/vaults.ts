import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import {
  BlocklistVault as BlocklistVaultTemplate,
  Erc20Vault as Erc20VaultTemplate,
  PrivateVault as PrivateVaultTemplate,
  RestakeVault as RestakeVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { VaultCreated } from '../../generated/templates/VaultFactory/VaultFactory'
import { Vault, VaultsStat } from '../../generated/schema'
import { createOrLoadNetwork, isGnosisNetwork } from './network'
import { createTransaction } from './transaction'
import { MULTICALL, WAD } from '../helpers/constants'
import { createOrLoadOsTokenConfig } from './osTokenConfig'
import { Multicall as MulticallContract, TryAggregateCallReturnDataStruct } from '../../generated/Keeper/Multicall'
import { getAggregateCall } from '../helpers/utils'

const vaultsStatId = '1'
const updateStateSelector = '0x1a7ff553'
const totalAssetsSelector = '0x01e1d114'
const totalSharesSelector = '0x3a98ef39'
const convertToAssetsSelector = '0x07a2d13a'
const swapXdaiToGnoSelector = '0xb0d11302'

export function createVault(
  event: VaultCreated,
  isPrivate: boolean,
  isErc20: boolean,
  isBlocklist: boolean,
  isRestake: boolean,
): void {
  const block = event.block
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()

  const vault = new Vault(vaultAddressHex)
  let decodedParams: ethereum.Tuple
  if (isErc20) {
    decodedParams = (
      ethereum.decode('(uint256,uint16,string,string,string)', event.params.params) as ethereum.Value
    ).toTuple()
    vault.tokenName = decodedParams[2].toString()
    vault.tokenSymbol = decodedParams[3].toString()
    Erc20VaultTemplate.create(vaultAddress)
  } else {
    decodedParams = (ethereum.decode('(uint256,uint16,string)', event.params.params) as ethereum.Value).toTuple()
  }
  const capacity = decodedParams[0].toBigInt()
  const feePercent = decodedParams[1].toI32()
  const admin = event.params.admin
  const ownMevEscrow = event.params.ownMevEscrow

  vault.factory = event.address
  vault.admin = admin
  vault.capacity = capacity
  vault.feePercent = feePercent
  vault.feeRecipient = admin
  vault.keysManager = admin // Deprecated
  vault.depositDataManager = admin
  vault.canHarvest = false
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.unconvertedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.latestExitTicket = BigInt.zero()
  vault.isPrivate = isPrivate
  vault.isBlocklist = isBlocklist
  vault.isRestake = isRestake
  vault.isErc20 = isErc20
  vault.isOsTokenEnabled = !isRestake
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.apySnapshotsCount = BigInt.zero()
  vault.apy = BigDecimal.zero()
  vault.weeklyApy = BigDecimal.zero()
  vault.executionApy = BigDecimal.zero()
  vault.consensusApy = BigDecimal.zero()
  vault.medianApy = BigDecimal.zero()
  vault.medianExecutionApy = BigDecimal.zero()
  vault.medianConsensusApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = BigInt.fromI32(1)
  vault.osTokenConfig = '1'

  createOrLoadOsTokenConfig('1')

  if (isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = admin
  }

  if (isBlocklist) {
    BlocklistVaultTemplate.create(vaultAddress)
    vault.blocklistManager = admin
  }

  if (isRestake) {
    RestakeVaultTemplate.create(vaultAddress)
    vault.restakeOperatorsManager = admin
    vault.restakeWithdrawalsManager = admin
  }

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = createOrLoadNetwork()
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.vaultsTotal = network.vaultsTotal + 1
  network.save()

  const vaultsStat = createOrLoadVaultsStat()
  vaultsStat.vaultsCount = vaultsStat.vaultsCount.plus(BigInt.fromI32(1))
  vaultsStat.save()

  createTransaction(event.transaction.hash.toHex())

  log.info(
    '[VaultFactory] VaultCreated address={} admin={} mevEscrow={} feePercent={} capacity={} isPrivate={} isErc20={} isBlocklist={} isRestake={}',
    [
      vaultAddressHex,
      admin.toHex(),
      ownMevEscrow.toHex(),
      feePercent.toString(),
      capacity.toString(),
      isPrivate.toString(),
      isErc20.toString(),
      isBlocklist.toString(),
      isRestake.toString(),
    ],
  )
}

export function convertSharesToAssets(vault: Vault, shares: BigInt): BigInt {
  if (vault.totalShares.equals(BigInt.zero())) {
    return shares
  }
  return shares.times(vault.totalAssets).div(vault.totalShares)
}

export function createOrLoadVaultsStat(): VaultsStat {
  let vaultsStat = VaultsStat.load(vaultsStatId)
  if (vaultsStat === null) {
    vaultsStat = new VaultsStat(vaultsStatId)
    vaultsStat.totalAssets = BigInt.zero()
    vaultsStat.vaultsCount = BigInt.zero()
    vaultsStat.save()
  }

  return vaultsStat
}

function getConvertToAssetsCall(shares: BigInt): Bytes {
  const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(shares))
  return Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs as Bytes)
}

export function getUpdateStateCall(
  rewardsRoot: Bytes,
  reward: BigInt,
  unlockedMevReward: BigInt,
  proof: Array<Bytes>,
): Bytes {
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

  const multicallContract = MulticallContract.bind(Address.fromString(MULTICALL))
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
