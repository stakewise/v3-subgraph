import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken } from '../../generated/schema'
import { OsTokenVaultController as OsTokenVaultControllerContact } from '../../generated/BlockHandlers/OsTokenVaultController'
import { OS_TOKEN_VAULT_CONTROLLER } from '../helpers/constants'

const osTokenId = '1'

export function createOrLoadOsToken(): OsToken {
  let osToken = OsToken.load(osTokenId)
  if (osToken === null) {
    osToken = new OsToken(osTokenId)

    osToken.apy = BigDecimal.zero()
    osToken.borrowApy = BigDecimal.zero()
    osToken.feePercent = 0
    osToken.totalSupply = BigInt.zero()
    osToken.totalAssets = BigInt.zero()
    osToken.snapshotsCount = BigInt.zero()
    osToken.save()
  }

  return osToken
}

export function updateOsTokenTotalAssets(osToken: OsToken): void {
  const osTokenVaultController = OsTokenVaultControllerContact.bind(OS_TOKEN_VAULT_CONTROLLER)
  osToken.totalAssets = osTokenVaultController.totalAssets()
}
