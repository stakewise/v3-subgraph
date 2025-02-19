import { Address, BigDecimal, BigInt, Bytes, ethereum, JSONValue, log, TypedMap } from '@graphprotocol/graph-ts'
import { Aave, Distributor, OsToken, OsTokenConfig, Vault, VaultSnapshot } from '../../generated/schema'
import {
  AAVE_LEVERAGE_STRATEGY,
  AAVE_LEVERAGE_STRATEGY_START_BLOCK,
  DEPOSIT_DATA_REGISTRY,
  FOX_VAULT1,
  FOX_VAULT2,
  MAX_VAULT_APY,
  VAULT_FACTORY_V2,
  VAULT_FACTORY_V3,
  WAD,
} from '../helpers/constants'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, getOsTokenApy, loadOsToken } from './osToken'
import { isGnosisNetwork, loadNetwork } from './network'
import { getV2PoolState, loadV2Pool, updatePoolApy } from './v2pool'
import { calculateAverage, chunkedVaultMulticall, getAnnualReward, getCompoundedApy } from '../helpers/utils'
import { createOrLoadOwnMevEscrow } from './mevEscrow'
import { VaultCreated } from '../../generated/templates/VaultFactory/VaultFactory'
import {
  BlocklistVault as BlocklistVaultTemplate,
  Erc20Vault as Erc20VaultTemplate,
  GnoVault as GnoVaultTemplate,
  OwnMevEscrow as OwnMevEscrowTemplate,
  PrivateVault as PrivateVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { createTransaction } from './transaction'
import { getAllocatorId } from './allocator'
import {
  convertStringToDistributionType,
  DistributionType,
  getPeriodicDistributionApy,
  loadDistributor,
  loadPeriodicDistribution,
} from './merkleDistributor'

const snapshotsPerWeek = 14
const snapshotsPerDay = 2
const secondsInYear = '31536000'
const maxPercent = '100'
const updateStateSelector = '0x1a7ff553'
const totalAssetsSelector = '0x01e1d114'
const totalSharesSelector = '0x3a98ef39'
const convertToAssetsSelector = '0x07a2d13a'
const getSharesSelector = '0xf04da65b'
const exitingAssetsSelector = '0xee3bd5df'
const queuedSharesSelector = '0xd83ad00c'

export function loadVault(vaultAddress: Address): Vault | null {
  return Vault.load(vaultAddress.toHex())
}

export function createVault(event: VaultCreated, isPrivate: boolean, isErc20: boolean, isBlocklist: boolean): void {
  const block = event.block
  const vaultAddress = event.params.vault
  const vaultAddressHex = vaultAddress.toHex()
  const isGnosis = isGnosisNetwork()

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
  vault.depositDataManager = admin
  vault.canHarvest = false
  vault.consensusReward = BigInt.zero()
  vault.lockedExecutionReward = BigInt.zero()
  vault.unlockedExecutionReward = BigInt.zero()
  vault.slashedMevReward = BigInt.zero()
  vault.totalShares = BigInt.zero()
  vault.queuedShares = BigInt.zero()
  vault.score = BigDecimal.zero()
  vault.totalAssets = BigInt.zero()
  vault.rate = BigInt.fromString(WAD)
  vault.exitingAssets = BigInt.zero()
  vault.exitingTickets = BigInt.zero()
  vault.isPrivate = isPrivate
  vault.isBlocklist = isBlocklist
  vault.isErc20 = isErc20
  vault.isOsTokenEnabled = true
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.lastXdaiSwappedTimestamp = block.timestamp
  vault._unclaimedFeeRecipientShares = BigInt.zero()
  vault.baseApy = BigDecimal.zero()
  vault.baseApys = []
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.osTokenHolderMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  if (vault.factory.equals(Address.fromString(VAULT_FACTORY_V2))) {
    vault.version = BigInt.fromI32(2)
    vault.osTokenConfig = '2'
  } else if (vault.factory.equals(Address.fromString(VAULT_FACTORY_V3))) {
    vault.version = BigInt.fromI32(3)
    vault.osTokenConfig = '2'
  } else {
    vault.version = BigInt.fromI32(isGnosis ? 2 : 1)
    vault.osTokenConfig = isGnosis ? '2' : '1'
  }

  if (vault.version.equals(BigInt.fromI32(1))) {
    // there is no validators manager for v1 vaults
    vault.validatorsManager = null
  } else {
    // default to deposit data registry
    vault.validatorsManager = DEPOSIT_DATA_REGISTRY
  }

  if (ownMevEscrow != Address.zero()) {
    OwnMevEscrowTemplate.create(ownMevEscrow)
    vault.mevEscrow = event.params.ownMevEscrow
  }

  if (isPrivate) {
    PrivateVaultTemplate.create(vaultAddress)
    vault.whitelister = admin
  }

  if (isBlocklist) {
    BlocklistVaultTemplate.create(vaultAddress)
    vault.blocklistManager = admin
  }

  if (isGnosis) {
    GnoVaultTemplate.create(vaultAddress)
  }

  vault.save()
  VaultTemplate.create(vaultAddress)

  const network = loadNetwork()!
  let vaultIds = network.vaultIds
  vaultIds.push(vaultAddressHex)
  network.vaultIds = vaultIds
  network.vaultsCount = network.vaultsCount + 1
  network.save()

  createTransaction(event.transaction.hash.toHex())

  log.info(
    '[VaultFactory] VaultCreated address={} admin={} mevEscrow={} feePercent={} capacity={} isPrivate={} isErc20={} isBlocklist={}',
    [
      vaultAddressHex,
      admin.toHex(),
      ownMevEscrow.toHex(),
      feePercent.toString(),
      capacity.toString(),
      isPrivate.toString(),
      isErc20.toString(),
      isBlocklist.toString(),
    ],
  )
}

export function convertSharesToAssets(vault: Vault, shares: BigInt): BigInt {
  if (vault.totalShares.equals(BigInt.zero())) {
    return shares
  }
  return shares.times(vault.totalAssets).div(vault.totalShares)
}

export function getVaultApy(vault: Vault, distributor: Distributor, osToken: OsToken, useDayApy: boolean): BigDecimal {
  const baseApys: Array<BigDecimal> = vault.baseApys

  let vaultApy: BigDecimal
  const baseApysCount = baseApys.length
  if (useDayApy && baseApysCount > snapshotsPerDay) {
    vaultApy = calculateAverage(baseApys.slice(baseApysCount - snapshotsPerDay))
  } else {
    vaultApy = vault.baseApy
  }

  // get additional periodic incentives
  const activeDistributionIds = distributor.activeDistributionIds
  for (let i = 0; i < activeDistributionIds.length; i++) {
    const distribution = loadPeriodicDistribution(activeDistributionIds[i])!
    if (convertStringToDistributionType(distribution.distributionType) !== DistributionType.VAULT) {
      continue
    }

    // get the distribution APY
    const distributionApy = getPeriodicDistributionApy(distribution, osToken, useDayApy)
    if (distributionApy.gt(BigDecimal.zero())) {
      vaultApy = vaultApy.plus(distributionApy)
    }
  }
  return vaultApy
}

export function getVaultOsTokenMintApy(osToken: OsToken, osTokenConfig: OsTokenConfig): BigDecimal {
  const osTokenApy = getOsTokenApy(osToken, false)
  const feePercentBigDecimal = BigDecimal.fromString(osToken.feePercent.toString())
  if (osTokenConfig.ltvPercent.isZero()) {
    log.error('getVaultOsTokenMintApy osTokenConfig.ltvPercent is zero osTokenConfig={}', [osTokenConfig.id])
    return BigDecimal.zero()
  }
  return osTokenApy
    .times(feePercentBigDecimal)
    .times(BigDecimal.fromString(WAD))
    .div(BigDecimal.fromString('10000').minus(feePercentBigDecimal))
    .div(osTokenConfig.ltvPercent.toBigDecimal())
}

export function getUpdateStateCall(vault: Vault): Bytes | null {
  if (
    vault.rewardsRoot === null ||
    vault.proofReward === null ||
    vault.proofUnlockedMevReward === null ||
    vault.proof === null
  ) {
    return null
  }

  const updateStateArray: Array<ethereum.Value> = [
    ethereum.Value.fromFixedBytes(vault.rewardsRoot!),
    ethereum.Value.fromSignedBigInt(vault.proofReward!),
    ethereum.Value.fromUnsignedBigInt(vault.proofUnlockedMevReward!),
    ethereum.Value.fromFixedBytesArray(vault.proof!.map<Bytes>((p: string) => Bytes.fromHexString(p))),
  ]
  // Encode the tuple
  const encodedUpdateStateArgs = ethereum.encode(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(updateStateArray)))
  return Bytes.fromHexString(updateStateSelector).concat(encodedUpdateStateArgs as Bytes)
}

export function updateVaults(
  ipfsData: JSONValue,
  rewardsRoot: Bytes,
  updateTimestamp: BigInt,
  rewardsIpfsHash: string,
): TypedMap<string, BigInt> {
  const vaultRewards = ipfsData.toObject().mustGet('vaults').toArray()
  const network = loadNetwork()!
  const isGnosis = isGnosisNetwork()
  const v2Pool = loadV2Pool()!
  const osToken = loadOsToken()!
  const distributor = loadDistributor()!

  // process vault rewards
  const feeRecipientsEarnedShares = new TypedMap<string, BigInt>()
  for (let i = 0; i < vaultRewards.length; i++) {
    // load vault object
    const vaultReward = vaultRewards[i].toObject()
    const vaultAddress = Address.fromString(vaultReward.mustGet('vault').toString())
    const vault = loadVault(vaultAddress)
    if (!vault) {
      log.error('[Keeper] RewardsUpdated vault={} not found', [vaultAddress.toHex()])
      continue
    }

    // extract vault reward data
    let lockedMevReward: BigInt
    if (!vault.mevEscrow) {
      // smoothing pool vault
      lockedMevReward = vaultReward.mustGet('locked_mev_reward').toBigInt()
    } else {
      lockedMevReward = BigInt.zero()
    }
    const unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const consensusReward = vaultReward.mustGet('consensus_reward').toBigInt()
    const proof = vaultReward
      .mustGet('proof')
      .toArray()
      .map<Bytes>((p: JSONValue): Bytes => Bytes.fromHexString(p.toString()) as Bytes)

    // calculate proof values for state update
    let proofReward: BigInt
    let proofUnlockedMevReward: BigInt
    if (vault.mevEscrow) {
      // vault has own mev escrow, proof reward is consensus reward, nothing can be locked
      proofReward = consensusReward
      proofUnlockedMevReward = BigInt.zero()
    } else if (isGnosis) {
      // for gnosis network, execution rewards are received in DAI and must be converted to GNO
      proofReward = consensusReward
      proofUnlockedMevReward = unlockedMevReward
    } else {
      // vault uses shared mev escrow, proof reward is consensus reward + total mev reward
      proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
      proofUnlockedMevReward = unlockedMevReward
    }

    // fetch new principal, total assets and rate
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = proofUnlockedMevReward
    vault.proof = proof.map<string>((proofValue: Bytes) => proofValue.toHexString())
    const newState = getVaultState(vault)
    const newRate = newState[0]
    const newTotalAssets = newState[1]
    const newTotalShares = newState[2]
    const newQueuedShares = newState[3]
    const newExitingAssets = newState[4]
    const feeRecipientShares = newState[5]

    // save fee recipient earned shares
    feeRecipientsEarnedShares.set(
      getAllocatorId(Address.fromBytes(vault.feeRecipient), vaultAddress),
      feeRecipientShares.minus(vault._unclaimedFeeRecipientShares),
    )

    // calculate smoothing pool penalty
    let slashedMevReward = vault.slashedMevReward
    if (vault.lockedExecutionReward.gt(lockedMevReward) && vault.unlockedExecutionReward.ge(unlockedMevReward)) {
      slashedMevReward = slashedMevReward.plus(vault.lockedExecutionReward.minus(lockedMevReward))
    }

    // update vault
    let vaultPeriodAssets = consensusReward.minus(vault.consensusReward)
    if (!isGnosis) {
      if (vault.mevEscrow) {
        // has own mev escrow
        const mevEscrow = Address.fromBytes(vault.mevEscrow!)
        const ownMevEscrow = createOrLoadOwnMevEscrow(mevEscrow)
        const newCheckpointAssets = ownMevEscrow.totalHarvestedAssets.plus(ethereum.getBalance(mevEscrow))
        vaultPeriodAssets = vaultPeriodAssets.plus(newCheckpointAssets).minus(ownMevEscrow.lastCheckpointAssets)
        ownMevEscrow.lastCheckpointAssets = newCheckpointAssets
        ownMevEscrow.save()
      } else {
        // uses smoothing pool
        vaultPeriodAssets = vaultPeriodAssets
          .plus(lockedMevReward)
          .plus(unlockedMevReward)
          .minus(vault.lockedExecutionReward)
          .minus(vault.unlockedExecutionReward)
      }
    }

    network.totalAssets = network.totalAssets.minus(vault.totalAssets).plus(newTotalAssets)
    network.totalEarnedAssets = network.totalEarnedAssets.plus(vaultPeriodAssets)

    updateVaultApy(
      vault,
      distributor,
      osToken,
      vault.rewardsTimestamp,
      updateTimestamp,
      newRate.minus(vault.rate),
      false,
    )
    vault.totalAssets = newTotalAssets
    vault.totalShares = newTotalShares
    vault.queuedShares = newQueuedShares
    vault.exitingAssets = newExitingAssets
    vault.rate = newRate
    vault.consensusReward = consensusReward
    vault.lockedExecutionReward = lockedMevReward
    vault.unlockedExecutionReward = unlockedMevReward
    vault.slashedMevReward = slashedMevReward
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    vault.canHarvest = true
    vault._unclaimedFeeRecipientShares = feeRecipientShares
    vault.save()

    // update v2 pool data
    if (vault.isGenesis && v2Pool.migrated) {
      const stateUpdate = getV2PoolState(vault)
      const newRate = stateUpdate[0]
      const newRewardAssets = stateUpdate[1]
      const newPrincipalAssets = stateUpdate[2]
      const newPenaltyAssets = stateUpdate[3]
      const poolNewTotalAssets = newRewardAssets.plus(newPrincipalAssets).minus(newPenaltyAssets)
      const poolRewardsDiff = newRewardAssets.minus(v2Pool.rewardAssets)
      vaultPeriodAssets = vaultPeriodAssets.minus(poolRewardsDiff)

      network.totalAssets = network.totalAssets.plus(poolRewardsDiff)
      updatePoolApy(v2Pool, v2Pool.rewardsTimestamp, updateTimestamp, newRate.minus(v2Pool.rate))
      v2Pool.rate = newRate
      v2Pool.principalAssets = newPrincipalAssets
      v2Pool.rewardAssets = newRewardAssets
      v2Pool.penaltyAssets = newPenaltyAssets
      v2Pool.totalAssets = poolNewTotalAssets
      v2Pool.rewardsTimestamp = updateTimestamp
      v2Pool.save()
    }
    snapshotVault(vault, distributor, osToken, vaultPeriodAssets, updateTimestamp)
  }
  network.save()
  return feeRecipientsEarnedShares
}

export function updateVaultMaxBoostApy(
  aave: Aave,
  osToken: OsToken,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  distributor: Distributor,
  blockNumber: BigInt,
): void {
  if (
    AAVE_LEVERAGE_STRATEGY.equals(Address.zero()) ||
    blockNumber.lt(BigInt.fromString(AAVE_LEVERAGE_STRATEGY_START_BLOCK)) ||
    !vault.isOsTokenEnabled ||
    !vault.isCollateralized
  ) {
    return
  }
  const wad = BigInt.fromString(WAD)

  const osTokenApy = getOsTokenApy(osToken, false)
  const borrowApy = aave.borrowApy
  // earned osToken shares earn extra staking rewards, apply compounding
  const supplyApy = getCompoundedApy(aave.supplyApy, osTokenApy)

  const vaultLeverageLtv = osTokenConfig.ltvPercent.lt(osTokenConfig.leverageMaxMintLtvPercent)
    ? osTokenConfig.ltvPercent
    : osTokenConfig.leverageMaxMintLtvPercent
  const aaveLeverageLtv = aave.leverageMaxBorrowLtvPercent
  if (vaultLeverageLtv.isZero() || aaveLeverageLtv.isZero()) {
    vault.allocatorMaxBoostApy = BigDecimal.zero()
    vault.osTokenHolderMaxBoostApy = BigDecimal.zero()
    vault.save()
    return
  }

  // calculate vault staking rate and the rate paid for minting osToken
  const vaultApy = getVaultApy(vault, distributor, osToken, false)
  const osTokenMintApy = getVaultOsTokenMintApy(osToken, osTokenConfig)

  // initial amounts for calculating earnings
  const boostedOsTokenAssets = wad
  const boostedOsTokenShares = convertAssetsToOsTokenShares(osToken, wad)

  // calculate assets/shares boosted from the strategy
  const totalLtv = vaultLeverageLtv.times(aaveLeverageLtv).div(wad)
  const strategyMintedOsTokenShares = boostedOsTokenShares
    .times(wad)
    .div(wad.minus(totalLtv))
    .minus(boostedOsTokenShares)
  const strategyMintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, strategyMintedOsTokenShares)
  const strategyDepositedAssets = strategyMintedOsTokenAssets.times(wad).div(vaultLeverageLtv)

  // calculate strategy earned assets from staking
  let strategyEarnedAssets = getAnnualReward(strategyDepositedAssets, vaultApy)

  // subtract apy lost on minting osToken
  strategyEarnedAssets = strategyEarnedAssets.minus(getAnnualReward(strategyMintedOsTokenAssets, osTokenMintApy))

  // all supplied osToken shares earn supply apy
  const earnedOsTokenShares = getAnnualReward(boostedOsTokenShares.plus(strategyMintedOsTokenShares), supplyApy)
  strategyEarnedAssets = strategyEarnedAssets.plus(convertOsTokenSharesToAssets(osToken, earnedOsTokenShares))

  // all borrowed assets lose borrow apy
  const borrowInterestAssets = getAnnualReward(strategyDepositedAssets, borrowApy)
  strategyEarnedAssets = strategyEarnedAssets.minus(borrowInterestAssets)

  // all the supplied OsToken assets earn the additional incentives
  const activeDistributionIds = distributor.activeDistributionIds
  for (let i = 0; i < activeDistributionIds.length; i++) {
    const distribution = loadPeriodicDistribution(activeDistributionIds[i])!
    if (convertStringToDistributionType(distribution.distributionType) !== DistributionType.LEVERAGE_STRATEGY) {
      continue
    }

    // get the distribution APY
    const distributionApy = getPeriodicDistributionApy(distribution, osToken, false)
    if (distributionApy.equals(BigDecimal.zero())) {
      continue
    }

    strategyEarnedAssets = strategyEarnedAssets.plus(
      getAnnualReward(boostedOsTokenAssets.plus(strategyMintedOsTokenAssets), distributionApy),
    )
  }

  // calculate average allocator max boost APY
  const allocatorDepositedAssets = boostedOsTokenAssets.times(wad).div(osTokenConfig.ltvPercent)
  const allocatorEarnedAssets = strategyEarnedAssets
    .plus(getAnnualReward(allocatorDepositedAssets, vaultApy))
    .minus(getAnnualReward(boostedOsTokenAssets, osTokenMintApy))
  const allocatorMaxBoostApy = allocatorEarnedAssets
    .toBigDecimal()
    .times(BigDecimal.fromString('100'))
    .div(allocatorDepositedAssets.toBigDecimal())

  // calculate average osToken holder max boost APY
  const osTokenHolderEarnedAssets = strategyEarnedAssets.plus(getAnnualReward(boostedOsTokenAssets, osTokenApy))
  const osTokenHolderMaxBoostApy = osTokenHolderEarnedAssets
    .toBigDecimal()
    .times(BigDecimal.fromString('100'))
    .div(boostedOsTokenAssets.toBigDecimal())

  if (
    allocatorMaxBoostApy.notEqual(vault.allocatorMaxBoostApy) ||
    osTokenHolderMaxBoostApy.notEqual(vault.osTokenHolderMaxBoostApy)
  ) {
    vault.allocatorMaxBoostApy = allocatorMaxBoostApy
    vault.osTokenHolderMaxBoostApy = osTokenHolderMaxBoostApy
    vault.save()
  }
}

export function snapshotVault(
  vault: Vault,
  distributor: Distributor,
  osToken: OsToken,
  earnedAssets: BigInt,
  timestamp: BigInt,
): void {
  let apy = getVaultApy(vault, distributor, osToken, true)
  const vaultSnapshot = new VaultSnapshot(timestamp.toString())
  vaultSnapshot.timestamp = timestamp.toI64()
  vaultSnapshot.vault = vault.id
  vaultSnapshot.earnedAssets = earnedAssets
  vaultSnapshot.totalAssets = vault.totalAssets
  vaultSnapshot.totalShares = vault.totalShares
  vaultSnapshot.apy = apy
  vaultSnapshot.save()
}

export function getVaultState(vault: Vault): Array<BigInt> {
  if (vault.isGenesis && !loadV2Pool()!.migrated) {
    return [BigInt.fromString(WAD), BigInt.zero(), BigInt.zero(), BigInt.zero(), BigInt.zero(), BigInt.zero()]
  }

  const isV2OrHigherVault = vault.version.ge(BigInt.fromI32(2))
  const updateStateCall = getUpdateStateCall(vault)

  let contractCalls: Array<Bytes> = []
  if (updateStateCall) {
    const getFeeRecipientSharesCall = _getSharesCall(Address.fromBytes(vault.feeRecipient))
    contractCalls.push(getFeeRecipientSharesCall)
    contractCalls.push(updateStateCall)
    contractCalls.push(getFeeRecipientSharesCall)
  }
  contractCalls.push(_getConvertToAssetsCall(BigInt.fromString(WAD)))
  contractCalls.push(Bytes.fromHexString(totalAssetsSelector))
  contractCalls.push(Bytes.fromHexString(totalSharesSelector))
  contractCalls.push(Bytes.fromHexString(queuedSharesSelector))
  if (isV2OrHigherVault) {
    contractCalls.push(Bytes.fromHexString(exitingAssetsSelector))
  }

  const vaultAddr = Address.fromString(vault.id)
  let results = chunkedVaultMulticall(vaultAddr, contractCalls)

  let feeRecipientEarnedShares = BigInt.zero()
  if (updateStateCall) {
    // calculate fee recipient earned shares
    const feeRecipientSharesBefore = ethereum.decode('uint256', results[0])!.toBigInt()
    const feeRecipientSharesAfter = ethereum.decode('uint256', results[2])!.toBigInt()
    feeRecipientEarnedShares = feeRecipientSharesAfter.minus(feeRecipientSharesBefore)

    // remove responses from the result
    results = results.slice(3)
  }

  const newRate = ethereum.decode('uint256', results[0])!.toBigInt()
  const totalAssets = ethereum.decode('uint256', results[1])!.toBigInt()
  const totalShares = ethereum.decode('uint256', results[2])!.toBigInt()
  const queuedShares = ethereum.decode('uint128', results[3])!.toBigInt()
  const exitingAssets = isV2OrHigherVault ? ethereum.decode('uint128', results[4])!.toBigInt() : vault.exitingAssets
  return [newRate, totalAssets, totalShares, queuedShares, exitingAssets, feeRecipientEarnedShares]
}

export function updateVaultApy(
  vault: Vault,
  distributor: Distributor,
  osToken: OsToken,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  rateChange: BigInt,
  appendToLast: boolean,
): void {
  if (!fromTimestamp) {
    // it's the first update, skip
    return
  }
  const totalDuration = toTimestamp.minus(fromTimestamp)
  if (totalDuration.isZero()) {
    log.error('[Vault] updateVaultApy totalDuration is zero fromTimestamp={} toTimestamp={}', [
      fromTimestamp.toString(),
      toTimestamp.toString(),
    ])
    return
  }

  let baseApys = vault.baseApys
  const baseApysCount = baseApys.length
  let currentBaseApy = rateChange
    .toBigDecimal()
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(BigDecimal.fromString(WAD))
    .div(totalDuration.toBigDecimal())

  if (appendToLast && baseApysCount > 0) {
    currentBaseApy = currentBaseApy.plus(baseApys[baseApysCount - 1])
  }
  const maxApy = BigDecimal.fromString(MAX_VAULT_APY)
  const vaultAddr = Address.fromString(vault.id)
  const isFoxVault =
    vaultAddr.equals(Address.fromString(FOX_VAULT1)) || vaultAddr.equals(Address.fromString(FOX_VAULT2))
  if (!isFoxVault && vault.version.equals(BigInt.fromI32(2)) && currentBaseApy.gt(maxApy)) {
    currentBaseApy = maxApy
  }

  if (appendToLast && baseApysCount > 0) {
    baseApys[baseApysCount - 1] = currentBaseApy
  } else {
    baseApys.push(currentBaseApy)
  }
  if (baseApysCount > snapshotsPerWeek) {
    baseApys = baseApys.slice(baseApysCount - snapshotsPerWeek)
  }
  vault.baseApys = baseApys
  vault.baseApy = calculateAverage(baseApys)
  vault.apy = getVaultApy(vault, distributor, osToken, false)
}

function _getConvertToAssetsCall(shares: BigInt): Bytes {
  const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(shares))
  return Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
}

function _getSharesCall(user: Address): Bytes {
  const encodedGetSharesArgs = ethereum.encode(ethereum.Value.fromAddress(user))
  return Bytes.fromHexString(getSharesSelector).concat(encodedGetSharesArgs!)
}
