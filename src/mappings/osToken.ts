import { log } from '@graphprotocol/graph-ts'
import { AvgRewardPerSecondUpdated } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { OsTokenSnapshot } from '../../generated/schema'

export function handleAvgRewardPerSecondUpdated(event: AvgRewardPerSecondUpdated): void {
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond
  const txHash = event.transaction.hash.toHex()
  const snapshot = new OsTokenSnapshot(`${txHash}-${event.transactionLogIndex.toString()}`)
  snapshot.avgRewardPerSecond = newAvgRewardPerSecond
  snapshot.createdAt = event.block.timestamp
  snapshot.save()

  log.info('[OsToken] AvgRewardPerSecondUpdated avgRewardPerSecond={} createdAt={}', [
    newAvgRewardPerSecond.toString(),
    snapshot.createdAt.toString(),
  ])
}
