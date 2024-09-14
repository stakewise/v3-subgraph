import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken } from '../../generated/schema'
import { OsTokenVaultController as OsTokenVaultControllerContact } from '../../generated/BlockHandlers/OsTokenVaultController'
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
    osToken.save()
  }

  return osToken
}

export function updateOsTokenApy(osToken: OsToken, newAvgRewardPerSecond: BigInt): void {
  const netAvgRewardPerSecond = newAvgRewardPerSecond
    .times(BigInt.fromI32(osToken.feePercent))
    .div(BigInt.fromString('10000'))
    .toString()

  const currentApy = BigDecimal.fromString(netAvgRewardPerSecond)
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

export function updateOsTokenTotalAssets(osToken: OsToken): void {
  const osTokenVaultController = OsTokenVaultControllerContact.bind(OS_TOKEN_VAULT_CONTROLLER)
  osToken.totalAssets = osTokenVaultController.totalAssets()
}
