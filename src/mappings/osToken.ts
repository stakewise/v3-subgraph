import { BigInt, log } from '@graphprotocol/graph-ts'
import { AvgRewardPerSecondUpdated, StateUpdated } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { OsTokenSnapshot } from '../../generated/schema'
import { createOrLoadOsToken, updateOsTokenApy } from '../entities/osToken'

export function handleAvgRewardPerSecondUpdated(event: AvgRewardPerSecondUpdated): void {
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond
  const osToken = createOrLoadOsToken()

  // create new snapshot
  const snapshot = new OsTokenSnapshot(osToken.snapshotsCount.toString())
  snapshot.avgRewardPerSecond = newAvgRewardPerSecond
  snapshot.createdAt = event.block.timestamp
  snapshot.save()

  // update OsToken
  updateOsTokenApy(osToken)
  osToken.snapshotsCount = osToken.snapshotsCount.plus(BigInt.fromI32(1))
  osToken.save()

  log.info('[OsTokenController] AvgRewardPerSecondUpdated avgRewardPerSecond={} createdAt={}', [
    newAvgRewardPerSecond.toString(),
    snapshot.createdAt.toString(),
  ])
}

export function handleStateUpdated(event: StateUpdated): void {
  const shares = event.params.treasuryShares
  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.save()

  log.info('[OsTokenController] StateUpdated treasuryShares={}', [shares.toString()])
}
