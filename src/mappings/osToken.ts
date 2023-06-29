import { log } from '@graphprotocol/graph-ts'
import { AvgRewardPerSecondUpdated } from '../../generated/OsToken/OsToken'
import { OsTokenSnapshot } from '../../generated/schema'

export function handleAvgRewardPerSecondUpdated(event: AvgRewardPerSecondUpdated): void {
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond
  const txHash = event.transaction.hash.toHex()
  const allocatorAction = new OsTokenSnapshot(`${txHash}-${event.transactionLogIndex.toString()}`)
  allocatorAction.avgRewardPerSecond = newAvgRewardPerSecond
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()

  log.info('[OsToken] AvgRewardPerSecondUpdated avgRewardPerSecond={}', [newAvgRewardPerSecond.toString()])
}
