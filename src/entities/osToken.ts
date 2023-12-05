import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { OsToken, OsTokenSnapshot } from '../../generated/schema'

const osTokenId = '1'
const snapshotsCount = 12
const secondsInYear = '31536000'
const maxPercent = '100'
const wad = '1000000000000000000'

export function createOrLoadOsToken(): OsToken {
  let osToken = OsToken.load(osTokenId)
  if (osToken === null) {
    osToken = new OsToken(osTokenId)

    osToken.apy = BigDecimal.zero()
    osToken.totalSupply = BigInt.zero()
    osToken.snapshotsCount = BigInt.zero()
    osToken.save()
  }

  return osToken
}

export function updateOsTokenApy(osToken: OsToken): void {
  let rewardPerSecondSum = BigInt.zero()
  let snapshotsCounter = 0

  for (let i = 0; i < snapshotsCount; i++) {
    const snapshot = OsTokenSnapshot.load(osToken.snapshotsCount.minus(BigInt.fromI32(i)).toString())
    if (snapshot === null) {
      break
    }

    rewardPerSecondSum = rewardPerSecondSum.plus(snapshot.avgRewardPerSecond)
    snapshotsCounter += 1
  }

  if (snapshotsCounter > 0) {
    osToken.apy = BigDecimal.fromString(rewardPerSecondSum.toString())
      .times(BigDecimal.fromString(secondsInYear))
      .times(BigDecimal.fromString(maxPercent))
      .div(BigDecimal.fromString(snapshotsCounter.toString()))
      .div(BigDecimal.fromString(wad))
  }
}
