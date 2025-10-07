import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { OsToken } from '../../generated/schema'
import { OsTokenVaultController as OsTokenVaultControllerContact } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { OS_TOKEN_VAULT_CONTROLLER, WAD } from '../helpers/constants'
import { calculateAverage } from '../helpers/utils'

const snapshotsPerWeek = 14
const secondsInYear = '31536000'
const maxPercent = '100'
export const osTokenId = '1'

export function loadOsToken(): OsToken | null {
  return OsToken.load(osTokenId)
}

export function createOrLoadOsToken(): OsToken {
  let osToken = OsToken.load(osTokenId)
  if (osToken === null) {
    osToken = new OsToken(osTokenId)

    osToken.apy = BigDecimal.zero()
    osToken.apys = []
    osToken.feePercent = 0
    osToken.totalSupply = BigInt.zero()
    osToken.totalAssets = BigInt.zero()
    osToken.save()
  }

  return osToken
}

export function updateOsTokenTotalAssets(osToken: OsToken): void {
  const osTokenVaultController = OsTokenVaultControllerContact.bind(OS_TOKEN_VAULT_CONTROLLER)
  const newTotalAssets = osTokenVaultController.totalAssets()
  const osTokenTotalAssetsDiff = newTotalAssets.minus(osToken.totalAssets)
  if (osTokenTotalAssetsDiff.lt(BigInt.zero())) {
    log.error('[OsToken] osTokenTotalAssetsDiff cannot be negative={}', [osTokenTotalAssetsDiff.toString()])
    return
  }
  osToken.totalAssets = newTotalAssets
  osToken.save()
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
  osToken.save()
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
