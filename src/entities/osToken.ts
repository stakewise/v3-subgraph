import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken } from '../../generated/schema'

const osTokenId = '1'

export function createOrLoadOsToken(): OsToken {
  let osToken = OsToken.load(osTokenId)
  if (osToken === null) {
    osToken = new OsToken(osTokenId)

    osToken.apy = BigDecimal.zero()
    osToken.borrowApy = BigDecimal.zero()
    osToken.feePercent = 0
    osToken.totalSupply = BigInt.zero()
    osToken.snapshotsCount = BigInt.zero()
    osToken.save()
  }

  return osToken
}
