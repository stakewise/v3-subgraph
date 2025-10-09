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
  WAD,
} from '../helpers/constants'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, loadOsToken } from './osToken'
import { increaseUserVaultsCount, isGnosisNetwork, loadNetwork } from './network'
import { getV2PoolRewardAssets, loadV2Pool } from './v2pool'
import {
  chunkedMulticall,
  encodeContractCall,
  getAnnualReward,
  getSnapshotTimestamp,
  isFailedUpdateStateCall,
} from '../helpers/utils'
import { syncEthOwnMevEscrow } from './mevEscrow'
import { syncXdaiConverter } from './xdaiConverter'
import { VaultCreated } from '../../generated/templates/VaultFactory/VaultFactory'
import {
  BlocklistVault as BlocklistVaultTemplate,
  Erc20Vault as Erc20VaultTemplate,
  OwnMevEscrow as OwnMevEscrowTemplate,
  PrivateVault as PrivateVaultTemplate,
  Vault as VaultTemplate,
} from '../../generated/templates'
import { createTransaction } from './transaction'
import { createOrLoadAllocator, getAllocatorLtv, getAllocatorLtvStatus } from './allocator'
import { loadOsTokenConfig } from './osTokenConfig'
import { updateExitRequests } from './exitRequest'
import { updateRewardSplitters } from './rewardSplitter'
import { convertStringToDistributionType, DistributionType, loadPeriodicDistribution } from './merkleDistributor'

const snapshotsPerWeek = 7
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

export function loadVaultSnapshot(vault: Vault, timestamp: i64): VaultSnapshot | null {
  const snapshotId = Bytes.fromHexString(vault.id).concat(Bytes.fromByteArray(Bytes.fromI64(timestamp)))
  return VaultSnapshot.load(snapshotId)
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
  vault.extraApy = BigDecimal.zero()
  vault.apy = BigDecimal.zero()
  vault.allocatorMaxBoostApy = BigDecimal.zero()
  vault.blocklistCount = BigInt.zero()
  vault.whitelistCount = BigInt.zero()
  vault.isGenesis = false
  vault.version = version
  vault._periodEarnedAssets = BigInt.zero()

  // the OsTokenConfig was updated for v2 vaults
  if (vault.version.equals(BigInt.fromI32(1))) {
    vault.osTokenConfig = '1'
  } else {
    vault.osTokenConfig = '2'
  }

  if (isGnosisNetwork()) {
    vault.validatorsManager = vault.version.equals(BigInt.fromI32(2)) ? DEPOSIT_DATA_REGISTRY : Address.zero()
  } else if (vault.version.equals(BigInt.fromI32(1))) {
    vault.validatorsManager = null
  } else {
    vault.validatorsManager = vault.version.lt(BigInt.fromI32(5)) ? DEPOSIT_DATA_REGISTRY : Address.zero()
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

export function createVaultSnapshot(vault: Vault, timestamp: i64): VaultSnapshot {
  const snapshotTimestamp = getSnapshotTimestamp(timestamp)
  let vaultApy = BigDecimal.zero()
  if (vault._lastSnapshotTimestamp > 0) {
    const prevSnapshot = loadVaultSnapshot(vault, vault._lastSnapshotTimestamp)!
    vaultApy = _getApyFromRateChange(vault.rate.minus(prevSnapshot._rate), snapshotTimestamp - prevSnapshot.timestamp)
  }

  const snapshotId = Bytes.fromHexString(vault.id).concat(Bytes.fromByteArray(Bytes.fromI64(snapshotTimestamp)))
  const vaultSnapshot = new VaultSnapshot(snapshotId)
  vaultSnapshot.timestamp = snapshotTimestamp
  vaultSnapshot.vault = vault.id
  vaultSnapshot.earnedAssets = vault._periodEarnedAssets
  vaultSnapshot.totalAssets = vault.totalAssets
  vaultSnapshot.totalShares = vault.totalShares
  vaultSnapshot.apy = vaultApy
  vaultSnapshot._rate = vault.rate
  vaultSnapshot._prevSnapshotTimestamp = vault._lastSnapshotTimestamp
  vaultSnapshot.save()

  // update period data
  vault._lastSnapshotTimestamp = snapshotTimestamp
  vault.save()

  return vaultSnapshot
}

export function convertSharesToAssets(vault: Vault, shares: BigInt): BigInt {
  if (vault.totalShares.equals(BigInt.zero())) {
    return shares
  }
  return shares.times(vault.totalAssets).div(vault.totalShares)
}

export function getVaultOsTokenMintApy(osToken: OsToken, osTokenConfig: OsTokenConfig): BigDecimal {
  const feePercentBigDecimal = BigDecimal.fromString(osToken.feePercent.toString())
  if (osTokenConfig.ltvPercent.isZero()) {
    log.error('getVaultOsTokenMintApy osTokenConfig.ltvPercent is zero osTokenConfig={}', [osTokenConfig.id])
    return BigDecimal.zero()
  }
  return osToken.apy
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

    // calculate period reward
    let vaultPeriodAssets = consensusReward.minus(vault.consensusReward)

    // add mev rewards
    if (isGnosis) {
      vaultPeriodAssets = vaultPeriodAssets.plus(syncXdaiConverter(vault))
    } else if (vault.mevEscrow) {
      // has own mev escrow
      vaultPeriodAssets = vaultPeriodAssets.plus(syncEthOwnMevEscrow(vault))
    } else {
      // uses smoothing pool
      vaultPeriodAssets = vaultPeriodAssets
        .plus(lockedMevReward)
        .plus(unlockedMevReward)
        .minus(vault.lockedExecutionReward)
        .minus(vault.unlockedExecutionReward)
    }

    network.totalAssets = network.totalAssets.minus(vault.totalAssets).plus(newTotalAssets)
    network.totalEarnedAssets = network.totalEarnedAssets.plus(vaultPeriodAssets)

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
    if (vault.isGenesis && v2Pool.migrated && !v2Pool.isDisconnected) {
      const newRewardAssets = getV2PoolRewardAssets(vault)
      const poolRewardsDiff = newRewardAssets.minus(v2Pool.rewardAssets)
      vaultPeriodAssets = vaultPeriodAssets.minus(poolRewardsDiff)
      network.totalAssets = network.totalAssets.plus(poolRewardsDiff)
      v2Pool.rewardAssets = newRewardAssets
      v2Pool.save()
    }

    // save fee recipient earned shares
    if (feeRecipientShares.gt(BigInt.zero())) {
      const feeRecipient = createOrLoadAllocator(Address.fromBytes(vault.feeRecipient), vaultAddress)
      if (feeRecipient.shares.isZero()) {
        increaseUserVaultsCount(feeRecipient.address)
      }
      const earnedShares = feeRecipientShares.minus(feeRecipient.shares)
      const assetsBefore = feeRecipient.assets

      // update fee recipient shares and assets
      feeRecipient.shares = feeRecipientShares
      feeRecipient.assets = convertSharesToAssets(vault, feeRecipientShares)
      if (earnedShares.lt(BigInt.zero())) {
        log.error('[Keeper] RewardsUpdated vault={} feeRecipient={} earnedShares is negative: {}', [
          vaultAddress.toHex(),
          feeRecipient.address.toHex(),
          earnedShares.toString(),
        ])
        feeRecipient.save()
        vault.save()
        continue
      }

      const feeRecipientEarnedAssets = feeRecipient.assets.minus(assetsBefore)
      feeRecipient._periodStakeEarnedAssets = feeRecipient._periodStakeEarnedAssets.plus(feeRecipientEarnedAssets)
      if (vault.isOsTokenEnabled) {
        feeRecipient.ltv = getAllocatorLtv(feeRecipient, osToken)
        feeRecipient.ltvStatus = getAllocatorLtvStatus(feeRecipient, loadOsTokenConfig(vault.osTokenConfig)!)
      }
      feeRecipient.save()
    }
    vault._periodEarnedAssets = vault._periodEarnedAssets.plus(vaultPeriodAssets)
    vault.save()
  }
  network.save()
}

export function getAllocatorMaxBoostApy(
  aave: Aave,
  osToken: OsToken,
  vault: Vault,
  osTokenConfig: OsTokenConfig,
  blockNumber: BigInt,
): BigDecimal {
  if (
    AAVE_LEVERAGE_STRATEGY_V1.equals(Address.zero()) ||
    blockNumber.lt(BigInt.fromString(AAVE_LEVERAGE_STRATEGY_V1_START_BLOCK)) ||
    !vault.isOsTokenEnabled ||
    !vault.isCollateralized
  ) {
    return BigDecimal.zero()
  }
  const wad = BigInt.fromString(WAD)

  const borrowApy = aave.borrowApy
  const vaultApy = vault.apy
  const osTokenMintApy = getVaultOsTokenMintApy(osToken, osTokenConfig)

  const vaultLeverageLtv = osTokenConfig.ltvPercent.lt(osTokenConfig.leverageMaxMintLtvPercent)
    ? osTokenConfig.ltvPercent
    : osTokenConfig.leverageMaxMintLtvPercent
  const aaveLeverageLtv = aave.leverageMaxBorrowLtvPercent
  if (vaultLeverageLtv.isZero() || aaveLeverageLtv.isZero()) {
    vault.allocatorMaxBoostApy = BigDecimal.zero()
    vault.save()
    return BigDecimal.zero()
  }
  const totalLtv = vaultLeverageLtv.times(aaveLeverageLtv).div(wad)

  // calculate allocator assets and shares
  const allocatorDepositedAssets = wad
  const allocatorMintedOsTokenAssets = allocatorDepositedAssets.times(osTokenConfig.ltvPercent).div(wad)
  const allocatorMintedOsTokenShares = convertAssetsToOsTokenShares(osToken, allocatorMintedOsTokenAssets)

  // calculate strategy assets and shares
  const strategyMintedOsTokenShares = allocatorMintedOsTokenShares
    .times(wad)
    .div(wad.minus(totalLtv))
    .minus(allocatorMintedOsTokenShares)
  const strategyMintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, strategyMintedOsTokenShares)
  const strategyDepositedAssets = strategyMintedOsTokenAssets.times(wad).div(vaultLeverageLtv)

  // allocator and strategy assets earn vault apy
  let totalEarnedAssets = getAnnualReward(allocatorDepositedAssets.plus(strategyDepositedAssets), vaultApy)

  // subtract apy lost on minting osToken
  totalEarnedAssets = totalEarnedAssets.minus(
    getAnnualReward(allocatorMintedOsTokenAssets.plus(strategyMintedOsTokenAssets), osTokenMintApy),
  )

  // subtract apy lost on borrowed assets
  totalEarnedAssets = totalEarnedAssets.minus(getAnnualReward(strategyDepositedAssets, borrowApy))

  // calculate allocator max boost APY
  return totalEarnedAssets
    .toBigDecimal()
    .times(BigDecimal.fromString('100'))
    .div(allocatorDepositedAssets.toBigDecimal())
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
  if (isFailedUpdateStateCall(vault)) {
    return [vault.rate, vault.totalAssets, vault.totalShares, vault.queuedShares, vault.exitingAssets, BigInt.zero()]
  }
  const vaultAddr = Address.fromString(vault.id)

  const updateStateCall = getUpdateStateCall(vault)
  const calls: Array<ethereum.Value> = [
    encodeContractCall(vaultAddr, _getSharesCall(Address.fromBytes(vault.feeRecipient))),
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

  let results = chunkedMulticall(updateStateCall, calls)

  const feeRecipientShares = ethereum.decode('uint256', results[0]!)!.toBigInt()
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

  return [newRate, totalAssets, totalShares, queuedShares, exitingAssets, feeRecipientShares]
}

export function getVaultBaseApy(vault: Vault): BigDecimal {
  if (vault._lastSnapshotTimestamp <= 0) {
    return BigDecimal.zero()
  }

  // base APY is calculated as an average of last 7 daily snapshots
  let apysCount = 0
  let apysSum = BigDecimal.zero()
  let prevSnapshotTimestamp = vault._lastSnapshotTimestamp
  for (let i = 0; i < snapshotsPerWeek; i++) {
    const vaultSnapshot = loadVaultSnapshot(vault, prevSnapshotTimestamp)!
    apysSum = apysSum.plus(vaultSnapshot.apy)
    apysCount++

    if (vaultSnapshot._prevSnapshotTimestamp <= 0) {
      break
    }
    prevSnapshotTimestamp = vaultSnapshot._prevSnapshotTimestamp
  }

  return apysCount > 0 ? apysSum.div(BigDecimal.fromString(apysCount.toString())) : BigDecimal.zero()
}

export function getVaultExtraApy(distributor: Distributor, vault: Vault): BigDecimal {
  let extraApy = BigDecimal.zero()
  // get additional periodic incentives
  const activeDistributionIds = distributor.activeDistributionIds
  for (let i = 0; i < activeDistributionIds.length; i++) {
    // check whether distribution is for vault
    const distribution = loadPeriodicDistribution(activeDistributionIds[i])!
    if (
      convertStringToDistributionType(distribution.distributionType) !== DistributionType.VAULT ||
      Address.fromBytes(distribution.data).notEqual(Address.fromString(vault.id))
    ) {
      continue
    }

    if (distribution.apy.lt(BigDecimal.zero())) {
      log.error('[Vault] getVaultExtraApy negative distribution APY distribution={} vault={} apy={}', [
        distribution.id,
        vault.id,
        distribution.apy.toString(),
      ])
      continue
    }
    // add distribution APY
    extraApy = extraApy.plus(distribution.apy)
  }

  return extraApy
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

function _getApyFromRateChange(rateChange: BigInt, duration: i64): BigDecimal {
  if (duration <= 0) {
    log.error('[Vault] _getApyFromRateChange invalid duration rateChange={} duration={}', [
      rateChange.toString(),
      duration.toString(),
    ])
    return BigDecimal.zero()
  }

  return rateChange
    .toBigDecimal()
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(BigDecimal.fromString(WAD))
    .div(BigDecimal.fromString(duration.toString()))
}

function _getConvertToAssetsCall(shares: BigInt): Bytes {
  const encodedConvertToAssetsArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(shares))
  return Bytes.fromHexString(convertToAssetsSelector).concat(encodedConvertToAssetsArgs!)
}

function _getSharesCall(user: Address): Bytes {
  const encodedGetSharesArgs = ethereum.encode(ethereum.Value.fromAddress(user))
  return Bytes.fromHexString(getSharesSelector).concat(encodedGetSharesArgs!)
}
