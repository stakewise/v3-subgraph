import { BigInt, log } from '@graphprotocol/graph-ts'
import { AvgRewardPerSecondUpdated, StateUpdated } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { OsTokenSnapshot } from '../../generated/schema'
import { createOrLoadOsToken, updateOsTokenApy, createOrLoadOsTokenHolder, isSupportedOsTokenHolder } from '../entities/osToken'
import { Transfer } from '../../generated/templates/Erc20Token/Erc20Token'

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

export function handleTransfer(event: Transfer): void {
  if (isSupportedOsTokenHolder(event.params.from)) {
    let fromHolder = createOrLoadOsTokenHolder(
      event.params.from,
    );

    fromHolder.shares = fromHolder.shares.minus(event.params.value);
    fromHolder.timestamp = event.block.timestamp;
    fromHolder.save();
  }

  if (isSupportedOsTokenHolder(event.params.to)) {
    let toHolder = createOrLoadOsTokenHolder(
      event.params.to,
    );

    toHolder.shares = toHolder.shares.plus(event.params.value);
    toHolder.timestamp = event.block.timestamp;
    toHolder.save();
  }

  log.info("[OsToken] Transfer from={} to={} amount={}", [
    event.params.from.toHexString(),
    event.params.to.toHexString(),
    event.params.value.toString(),
  ]);
}
