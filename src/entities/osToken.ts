import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import {
  LeverageStrategyPosition,
  Network,
  OsToken,
  OsTokenHolder,
  OsTokenHolderSnapshot,
  OsTokenSnapshot,
  Vault,
} from '../../generated/schema'
import { OsTokenVaultController as OsTokenVaultControllerContact } from '../../generated/Keeper/OsTokenVaultController'
import { OS_TOKEN_VAULT_CONTROLLER, WAD } from '../helpers/constants'
import { calculateAverage } from '../helpers/utils'
import { createOrLoadSnapshotEarnedAssets } from './snapshot'

const osTokenId = '1'
const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'

export function createOrLoadOsToken(): OsToken {
  let osToken = OsToken.load(osTokenId)
  if (osToken === null) {
    osToken = new OsToken(osTokenId)

    osToken.apy = BigDecimal.zero()
    osToken.apys = []
    osToken.feePercent = 0
    osToken.totalSupply = BigInt.zero()
    osToken.totalAssets = BigInt.zero()
    osToken.lastUpdateTimestamp = BigInt.zero()
    osToken.save()
  }

  return osToken
}

export function createOrLoadOsTokenHolder(osToken: OsToken, holderAddress: Address): OsTokenHolder {
  const id = holderAddress.toHex()
  let holder = OsTokenHolder.load(id)

  if (holder === null) {
    holder = new OsTokenHolder(id)
    holder.balance = BigInt.zero()
    holder.assets = BigInt.zero()
    holder.osToken = osToken.id
    holder.transfersCount = BigInt.zero()
    holder.apy = BigDecimal.zero()
    holder.save()
  }

  return holder
}

export function convertOsTokenSharesToAssets(osToken: OsToken, shares: BigInt): BigInt {
  if (osToken.totalSupply.isZero()) {
    return shares
  } else {
    return shares.times(osToken.totalAssets).div(osToken.totalSupply)
  }
}

export function convertAssetsToOsTokenShares(osToken: OsToken, assets: BigInt): BigInt {
  if (osToken.totalAssets.isZero()) {
    return assets
  } else {
    return assets.times(osToken.totalSupply).div(osToken.totalAssets)
  }
}

export function updateOsTokenApy(osToken: OsToken, newAvgRewardPerSecond: BigInt): void {
  const netAvgRewardPerSecond = newAvgRewardPerSecond
    .times(BigInt.fromI32(10000 - osToken.feePercent))
    .div(BigInt.fromI32(10000))

  const currentApy = new BigDecimal(netAvgRewardPerSecond)
    .times(BigDecimal.fromString(secondsInYear))
    .times(BigDecimal.fromString(maxPercent))
    .div(BigDecimal.fromString(WAD))

  let apys = osToken.apys
  apys.push(currentApy)
  if (apys.length > snapshotsPerWeek) {
    apys = apys.slice(apys.length - snapshotsPerWeek)
  }
  osToken.apys = apys
  osToken.apy = calculateAverage(apys)
}

export function getOsTokenHolderApy(network: Network, osToken: OsToken, osTokenHolder: OsTokenHolder): BigDecimal {
  const osTokenVaultIds = network.osTokenVaultIds

  // add osToken shares from all strategy positions
  let totalOsTokenShares = osTokenHolder.balance
  let strategyPositions: Array<LeverageStrategyPosition> = []
  for (let i = 0; i < osTokenVaultIds.length; i++) {
    const leverageStrategyPosition = LeverageStrategyPosition.load(`${osTokenVaultIds[i]}-${osTokenHolder.id}`)
    if (leverageStrategyPosition !== null) {
      strategyPositions.push(leverageStrategyPosition as LeverageStrategyPosition)
      totalOsTokenShares = totalOsTokenShares.plus(leverageStrategyPosition.osTokenShares)
    }
  }

  if (totalOsTokenShares.le(BigInt.zero())) {
    return BigDecimal.zero()
  }

  // calculate apy based on the max osToken assets
  let apy = osToken.apy
  for (let i = 0; i < strategyPositions.length; i++) {
    const strategyPosition = strategyPositions[i]
    const vault = Vault.load(strategyPosition.vault) as Vault
    const boostApy = vault.osTokenHolderMaxBoostApy
      .minus(osToken.apy)
      .times(strategyPosition.osTokenShares.toBigDecimal())
      .div(totalOsTokenShares.toBigDecimal())
    apy = apy.plus(boostApy)
  }

  return apy
}

export function updateOsTokenHoldersApy(network: Network, osToken: OsToken): void {
  const osTokenHolders: Array<OsTokenHolder> = osToken.holders.load()
  for (let i = 0; i < osTokenHolders.length; i++) {
    const osTokenHolder = osTokenHolders[i]
    osTokenHolder.apy = getOsTokenHolderApy(network, osToken, osTokenHolder)
    osTokenHolder.save()
  }
}

export function updateOsTokenTotalAssets(osToken: OsToken, updateTimestamp: BigInt, block: ethereum.Block): BigInt {
  if (osToken.lastUpdateTimestamp.isZero()) {
    osToken.lastUpdateTimestamp = updateTimestamp
    return BigInt.zero()
  }

  const totalDuration = updateTimestamp.minus(osToken.lastUpdateTimestamp)
  if (totalDuration.lt(BigInt.zero())) {
    log.error('[OsToken] totalDuration cannot be negative={}', [totalDuration.toString()])
    return BigInt.zero()
  }

  let updateSlippageSeconds = block.timestamp.minus(updateTimestamp)
  if (updateSlippageSeconds.lt(BigInt.zero())) {
    log.error('[OsToken] updateSlippageSeconds cannot be negative={}', [updateSlippageSeconds.toString()])
    updateSlippageSeconds = BigInt.zero()
  }

  const osTokenVaultController = OsTokenVaultControllerContact.bind(OS_TOKEN_VAULT_CONTROLLER)
  const newTotalAssets = osTokenVaultController.totalAssets()
  if (newTotalAssets.lt(osToken.totalAssets)) {
    log.error('[OsToken] newTotalAssets cannot be less than current current={} new={}', [
      osToken.totalAssets.toString(),
      newTotalAssets.toString(),
    ])
    return BigInt.zero()
  }

  let totalAssetsDiff = newTotalAssets.minus(osToken.totalAssets)
  if (!updateSlippageSeconds.isZero()) {
    totalAssetsDiff = totalAssetsDiff.minus(totalAssetsDiff.times(updateSlippageSeconds).div(totalDuration))
  }
  osToken.totalAssets = osToken.totalAssets.plus(totalAssetsDiff)
  osToken.lastUpdateTimestamp = updateTimestamp
  return totalAssetsDiff
}

export function snapshotOsToken(osToken: OsToken, assetsDiff: BigInt, rewardsTimestamp: BigInt): void {
  const snapshotEarnedAssets = createOrLoadSnapshotEarnedAssets('osToken', osToken.id, rewardsTimestamp)
  snapshotEarnedAssets.earnedAssets = snapshotEarnedAssets.earnedAssets.plus(assetsDiff)
  snapshotEarnedAssets.save()

  let apy = BigDecimal.zero()
  const principalAssets = osToken.totalAssets
    .minus(snapshotEarnedAssets.earnedAssets)
    .minus(snapshotEarnedAssets.earnedAssets.times(BigInt.fromI32(osToken.feePercent)).div(BigInt.fromI32(10000)))
  if (principalAssets.gt(BigInt.zero())) {
    apy = new BigDecimal(snapshotEarnedAssets.earnedAssets)
      .times(BigDecimal.fromString('365'))
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(principalAssets))
  }

  const osTokenSnapshot = new OsTokenSnapshot(rewardsTimestamp.toString())
  osTokenSnapshot.timestamp = rewardsTimestamp.toI64()
  osTokenSnapshot.earnedAssets = assetsDiff
  osTokenSnapshot.totalAssets = osToken.totalAssets
  osTokenSnapshot.apy = apy
  osTokenSnapshot.save()
}

export function snapshotOsTokenHolder(holder: OsTokenHolder, assetsDiff: BigInt, timestamp: BigInt): void {
  const snapshotEarnedAssets = createOrLoadSnapshotEarnedAssets('osTokenHolder', holder.id, timestamp)
  snapshotEarnedAssets.earnedAssets = snapshotEarnedAssets.earnedAssets.plus(assetsDiff)
  snapshotEarnedAssets.save()

  let apy = BigDecimal.zero()
  const principalAssets = holder.assets.minus(snapshotEarnedAssets.earnedAssets)
  if (principalAssets.gt(BigInt.zero())) {
    apy = new BigDecimal(snapshotEarnedAssets.earnedAssets)
      .times(BigDecimal.fromString('365'))
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(principalAssets))
  }

  const snapshot = new OsTokenHolderSnapshot(timestamp.toString())
  snapshot.timestamp = timestamp.toI64()
  snapshot.osTokenHolder = holder.id
  snapshot.earnedAssets = assetsDiff
  snapshot.totalAssets = holder.assets
  snapshot.apy = apy
  snapshot.save()
}
