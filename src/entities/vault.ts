import { Address, BigDecimal, BigInt, Bytes, ethereum, JSONValue, log } from '@graphprotocol/graph-ts'
import {
  Aave,
  Allocator,
  Distributor,
  Network,
  OsToken,
  OsTokenConfig,
  Vault,
  VaultSnapshot,
} from '../../generated/schema'
import {
  AAVE_LEVERAGE_STRATEGY_V1,
  AAVE_LEVERAGE_STRATEGY_V1_START_BLOCK,
  DEPOSIT_DATA_REGISTRY,
  FOX_VAULT1,
  FOX_VAULT2,
  MAX_VAULT_APY,
  WAD,
} from '../helpers/constants'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, getOsTokenApy, loadOsToken } from './osToken'
import { increaseUserVaultsCount, isGnosisNetwork, loadNetwork } from './network'
import { getV2PoolState, loadV2Pool, updatePoolApy } from './v2pool'
import {
  calculateApy,
  calculateAverage,
  chunkedMulticall,
  encodeContractCall,
  getAnnualReward,
  getCompoundedApy,
} from '../helpers/utils'
import { createOrLoadOwnMevEscrow } from './mevEscrow'
import { VaultCreated } from '../../generated/templates/VaultFactory/VaultFactory'
import {
  BlocklistVault as BlocklistVaultTemplate,
  Erc20Vault as Erc20VaultTemplate,
  OwnMevEscrow as OwnMevEscrowTemplate,
  PrivateVault as PrivateVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { createTransaction } from './transaction'
import {
  createOrLoadAllocator,
  getAllocatorLtv,
  getAllocatorLtvStatus,
  syncAllocatorPeriodStakeEarnedAssets,
} from './allocator'
import {
  convertStringToDistributionType,
  DistributionType,
  getPeriodicDistributionApy,
  loadDistributor,
  loadPeriodicDistribution,
} from './merkleDistributor'
import { loadOsTokenConfig } from './osTokenConfig'
import { updateExitRequests } from './exitRequest'
import { updateRewardSplitters } from './rewardSplitter'

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
const exitQueueDataSelector = '0x3e1655d3'

export function loadVault(vaultAddress: Address): Vault | null {
  return Vault.load(vaultAddress.toHex())
}

export function isFoxVault(vaultAddress: Address): boolean {
  return vaultAddress.equals(Address.fromString(FOX_VAULT1)) || vaultAddress.equals(Address.fromString(FOX_VAULT2))
}

export function createVault(
  event: VaultCreated,
  version: BigInt,
  isPrivate: boolean,
  isErc20: boolean,
  isBlocklist: boolean,
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
    vault.metadataIpfsHash = decodedParams[4].toString()
    Erc20VaultTemplate.create(vaultAddress)
  } else {
    decodedParams = (ethereum.decode('(uint256,uint16,string)', event.params.params) as ethereum.Value).toTuple()
    vault.metadataIpfsHash = decodedParams[2].toString()
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
  vault.isMetaVault = false
  vault.isOsTokenEnabled = true
  vault.isCollateralized = false
  vault.addressString = vaultAddressHex
  vault.createdAt = block.timestamp
  vault.baseApy = BigDecimal.zero()
  vault.baseApys = []
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.osTokenHolderMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = version
  vault._periodStakeEarnedAssets = BigInt.zero()
  vault._periodExtraEarnedAssets = BigInt.zero()
  vault._unclaimedFeeRecipientShares = BigInt.zero()

  if (vault.version.equals(BigInt.fromI32(1))) {
    // there is no validators manager for v1 vaults
    vault.validatorsManager = null
    vault.osTokenConfig = '1'
  } else {
    // default to deposit data registry
    vault.validatorsManager = DEPOSIT_DATA_REGISTRY
    vault.osTokenConfig = '2'
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
    if (
      convertStringToDistributionType(distribution.distributionType) !== DistributionType.VAULT ||
      Address.fromBytes(distribution.data).notEqual(Address.fromString(vault.id))
    ) {
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

export function getUpdateStateCall(vault: Vault): ethereum.Value | null {
  if (
    vault.isMetaVault ||
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
  return encodeContractCall(
    Address.fromString(vault.id),
    Bytes.fromHexString(updateStateSelector).concat(encodedUpdateStateArgs!),
  )
}

export function updateVaults(
  ipfsData: JSONValue,
  rewardsRoot: Bytes,
  updateTimestamp: BigInt,
  rewardsIpfsHash: string,
): void {
  const vaultRewards = ipfsData.toObject().mustGet('vaults').toArray()
  const network = loadNetwork()!
  const isGnosis = isGnosisNetwork()
  const v2Pool = loadV2Pool()!
  const osToken = loadOsToken()!
  const distributor = loadDistributor()!

  // process vault rewards
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

    updateVaultApy(vault, distributor, osToken, vault.rewardsTimestamp, updateTimestamp, newRate.minus(vault.rate))
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

    // save fee recipient earned shares
    if (feeRecipientShares.gt(BigInt.zero())) {
      const feeRecipient = createOrLoadAllocator(Address.fromBytes(vault.feeRecipient), vaultAddress)
      if (feeRecipient.shares.isZero()) {
        increaseUserVaultsCount(feeRecipient.address)
      }
      // update stake earned assets for the current stake shares
      syncAllocatorPeriodStakeEarnedAssets(vault, feeRecipient)
      const assetsBefore = convertSharesToAssets(vault, feeRecipient.shares)

      // update fee recipient shares and assets
      feeRecipient.shares = feeRecipient.shares.plus(feeRecipientShares.minus(vault._unclaimedFeeRecipientShares))
      feeRecipient.assets = convertSharesToAssets(vault, feeRecipient.shares)

      const feeRecipientEarnedAssets = feeRecipient.assets.minus(assetsBefore)
      feeRecipient._periodExtraEarnedAssets = feeRecipient._periodExtraEarnedAssets.plus(feeRecipientEarnedAssets)
      if (vault.isOsTokenEnabled) {
        feeRecipient.ltv = getAllocatorLtv(feeRecipient, osToken)
        feeRecipient.ltvStatus = getAllocatorLtvStatus(feeRecipient, loadOsTokenConfig(vault.osTokenConfig)!)
      }
      feeRecipient.save()
      vaultPeriodAssets = vaultPeriodAssets.minus(feeRecipientEarnedAssets)
    }
    vault._periodStakeEarnedAssets = vault._periodStakeEarnedAssets.plus(vaultPeriodAssets)
    vault._unclaimedFeeRecipientShares = feeRecipientShares
    vault.save()
  }
  network.save()
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
    AAVE_LEVERAGE_STRATEGY_V1.equals(Address.zero()) ||
    blockNumber.lt(BigInt.fromString(AAVE_LEVERAGE_STRATEGY_V1_START_BLOCK)) ||
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
  }
}

export function snapshotVault(vault: Vault, timestamp: BigInt, duration: BigInt): void {
  const vaultSnapshot = new VaultSnapshot(1)
  vaultSnapshot.timestamp = timestamp.toI64()
  vaultSnapshot.vault = vault.id
  vaultSnapshot.stakeEarnedAssets = vault._periodStakeEarnedAssets
  vaultSnapshot.extraEarnedAssets = vault._periodExtraEarnedAssets
  vaultSnapshot.earnedAssets = vault._periodStakeEarnedAssets.plus(vault._periodExtraEarnedAssets)
  vaultSnapshot.totalAssets = vault.totalAssets
  vaultSnapshot.totalShares = vault.totalShares
  vaultSnapshot.apy = calculateApy(
    vaultSnapshot.earnedAssets,
    vault.totalAssets.minus(vault._periodStakeEarnedAssets),
    duration,
  )
  vaultSnapshot.save()
}

export function getVaultState(vault: Vault): Array<BigInt> {
  if (vault.isGenesis && !loadV2Pool()!.migrated) {
    return [
      BigInt.fromString(WAD),
      vault.totalAssets,
      vault.totalShares,
      vault.queuedShares,
      vault.exitingAssets,
      BigInt.zero(),
    ]
  }
  const vaultAddr = Address.fromString(vault.id)

  // fetch fee recipient shares before state update
  const getFeeRecipientSharesCall = _getSharesCall(Address.fromBytes(vault.feeRecipient))
  let results = chunkedMulticall(null, [encodeContractCall(vaultAddr, getFeeRecipientSharesCall)])
  const feeRecipientSharesBefore = ethereum.decode('uint256', results[0]!)!.toBigInt()

  const updateStateCalls = getUpdateStateCall(vault)
  const calls: Array<ethereum.Value> = [
    encodeContractCall(vaultAddr, getFeeRecipientSharesCall),
    encodeContractCall(vaultAddr, _getConvertToAssetsCall(BigInt.fromString(WAD))),
    encodeContractCall(vaultAddr, Bytes.fromHexString(totalAssetsSelector)),
    encodeContractCall(vaultAddr, Bytes.fromHexString(totalSharesSelector)),
  ]

  const isGnosis = isGnosisNetwork()
  let hasQueuedShares: boolean
  let hasExitingAssets: boolean
  let hasExitQueueData: boolean
  if (isGnosis) {
    hasQueuedShares = vault.version.le(BigInt.fromI32(vault.isGenesis ? 3 : 2))
    hasExitingAssets = vault.version.le(BigInt.fromI32(vault.isGenesis ? 3 : 2))
    hasExitQueueData = vault.version.ge(BigInt.fromI32(vault.isGenesis ? 4 : 3))
  } else if (isFoxVault(vaultAddr)) {
    hasQueuedShares = vault.version.le(BigInt.fromI32(1))
    hasExitingAssets = false
    hasExitQueueData = vault.version.ge(BigInt.fromI32(2))
  } else {
    hasQueuedShares = vault.version.le(BigInt.fromI32(4))
    hasExitingAssets = vault.version.ge(BigInt.fromI32(2)) && vault.version.le(BigInt.fromI32(4))
    hasExitQueueData = vault.version.ge(BigInt.fromI32(5))
  }

  if (hasQueuedShares) {
    calls.push(encodeContractCall(vaultAddr, Bytes.fromHexString(queuedSharesSelector)))
  }
  if (hasExitingAssets) {
    calls.push(encodeContractCall(vaultAddr, Bytes.fromHexString(exitingAssetsSelector)))
  }
  if (hasExitQueueData) {
    calls.push(encodeContractCall(vaultAddr, Bytes.fromHexString(exitQueueDataSelector)))
  }

  results = chunkedMulticall(updateStateCalls, calls)
  const feeRecipientSharesAfter = ethereum.decode('uint256', results[0]!)!.toBigInt()
  const feeRecipientEarnedShares = feeRecipientSharesAfter.minus(feeRecipientSharesBefore)

  const newRate = ethereum.decode('uint256', results[1]!)!.toBigInt()
  const totalAssets = ethereum.decode('uint256', results[2]!)!.toBigInt()
  const totalShares = ethereum.decode('uint256', results[3]!)!.toBigInt()

  results = results.slice(4)

  let queuedShares = BigInt.zero()
  let exitingAssets = BigInt.zero()
  if (hasQueuedShares) {
    queuedShares = ethereum.decode('uint256', results[0]!)!.toBigInt()
    results = results.slice(1)
  }
  if (hasExitingAssets) {
    exitingAssets = ethereum.decode('uint256', results[0]!)!.toBigInt()
    results = results.slice(1)
  }
  if (hasExitQueueData) {
    const exitQueueData = ethereum.decode('(uint128,uint128,uint128,uint128,uint256)', results[0]!)!.toTuple()
    queuedShares = exitQueueData[0].toBigInt()
    exitingAssets = exitQueueData[3].toBigInt()
  }

  return [newRate, totalAssets, totalShares, queuedShares, exitingAssets, feeRecipientEarnedShares]
}

export function updateVaultApy(
  vault: Vault,
  distributor: Distributor,
  osToken: OsToken,
  fromTimestamp: BigInt | null,
  toTimestamp: BigInt,
  rateChange: BigInt,
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

  const maxApy = BigDecimal.fromString(MAX_VAULT_APY)
  const vaultAddr = Address.fromString(vault.id)
  const isFoxVault =
    vaultAddr.equals(Address.fromString(FOX_VAULT1)) || vaultAddr.equals(Address.fromString(FOX_VAULT2))
  if (!isFoxVault && vault.version.equals(BigInt.fromI32(2)) && currentBaseApy.gt(maxApy)) {
    currentBaseApy = maxApy
  }
  baseApys.push(currentBaseApy)
  if (baseApysCount > snapshotsPerWeek) {
    baseApys = baseApys.slice(baseApysCount - snapshotsPerWeek)
  }
  vault.baseApys = baseApys
  vault.baseApy = calculateAverage(baseApys)
  vault.apy = getVaultApy(vault, distributor, osToken, false)
}

export function syncVault(network: Network, osToken: OsToken, vault: Vault, newTimestamp: BigInt): void {
  let allocator: Allocator
  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
  const allocators: Array<Allocator> = vault.allocators.load()
  for (let j = 0; j < allocators.length; j++) {
    allocator = allocators[j]
    if (allocator.shares.le(BigInt.zero())) {
      continue
    }
    const assetsBefore = allocator.assets
    allocator.assets = convertSharesToAssets(vault, allocator.shares)

    if (vault.isOsTokenEnabled) {
      allocator.ltv = getAllocatorLtv(allocator, osToken)
      allocator.ltvStatus = getAllocatorLtvStatus(allocator, osTokenConfig)
    }

    allocator._periodStakeEarnedAssets = allocator._periodStakeEarnedAssets.plus(allocator.assets.minus(assetsBefore))
    allocator.save()
  }

  // update exit requests
  updateExitRequests(network, vault, newTimestamp)

  // update reward splitters
  updateRewardSplitters(vault)
}

function _getConvertToAssetsCall(shares: BigInt): Bytes {
  const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(shares))
  return Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
}

function _getSharesCall(user: Address): Bytes {
  const encodedGetSharesArgs = ethereum.encode(ethereum.Value.fromAddress(user))
  return Bytes.fromHexString(getSharesSelector).concat(encodedGetSharesArgs!)
}
