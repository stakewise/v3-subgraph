import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { OsToken, OsTokenHolder, OsTokenHolderSnapshot, OsTokenSnapshot } from '../../generated/schema'
import { OsTokenVaultController as OsTokenVaultControllerContact } from '../../generated/Keeper/OsTokenVaultController'
import { OS_TOKEN_VAULT_CONTROLLER, WAD } from '../helpers/constants'
import { calculateAverage } from '../helpers/utils'

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
    holder.save()
  }

  return holder
}

export function getOsTokenLastApy(osToken: OsToken): BigDecimal {
  const apys = osToken.apys
  if (apys.length > 1) {
    return apys[apys.length - 2]
  }
  return BigDecimal.zero()
}

export function convertOsTokenSharesToAssets(osToken: OsToken, shares: BigInt): BigInt {
  if (osToken.totalAssets.isZero()) {
    return shares
  } else {
    return shares.times(osToken.totalAssets).div(osToken.totalSupply)
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
  const osTokenSnapshot = new OsTokenSnapshot('1')
  osTokenSnapshot.timestamp = rewardsTimestamp.toI64()
  osTokenSnapshot.totalAssets = osToken.totalAssets
  osTokenSnapshot.earnedAssets = assetsDiff.plus(
    assetsDiff.times(BigInt.fromI32(osToken.feePercent)).div(BigInt.fromI32(10000 - osToken.feePercent)),
  )
  osTokenSnapshot.apy = getOsTokenLastApy(osToken)
  osTokenSnapshot.save()
}

export function snapshotOsTokenHolder(
  holder: OsTokenHolder,
  osToken: OsToken,
  assetsDiff: BigInt,
  timestamp: BigInt,
): void {
  const snapshot = new OsTokenHolderSnapshot('1')
  snapshot.timestamp = timestamp.toI64()
  snapshot.osTokenHolder = holder.id
  snapshot.earnedAssets = assetsDiff
  snapshot.apy = getOsTokenLastApy(osToken)
  snapshot.save()
}
