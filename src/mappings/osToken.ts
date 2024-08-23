import { log } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/Erc20Token/Erc20Token'
import { AvgRewardPerSecondUpdated, StateUpdated } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { updateOsTokenApy } from '../entities/apySnapshots'
import { createTokenTransfer } from '../entities/tokenTransfer'
import { createOrLoadOsToken, isSupportedOsTokenHolder, createOrLoadOsTokenHolder } from '../entities/osToken'

export function handleAvgRewardPerSecondUpdated(event: AvgRewardPerSecondUpdated): void {
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond
  const osToken = createOrLoadOsToken()

  // update OsToken
  updateOsTokenApy(osToken, newAvgRewardPerSecond, event.block.timestamp)
  osToken.save()

  log.info('[OsTokenController] AvgRewardPerSecondUpdated avgRewardPerSecond={}', [newAvgRewardPerSecond.toString()])
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
    let fromHolder = createOrLoadOsTokenHolder(event.params.from)

    fromHolder.shares = fromHolder.shares.minus(event.params.value)
    fromHolder.timestamp = event.block.timestamp
    fromHolder.save()
  }

  if (isSupportedOsTokenHolder(event.params.to)) {
    let toHolder = createOrLoadOsTokenHolder(event.params.to)

    toHolder.shares = toHolder.shares.plus(event.params.value)
    toHolder.timestamp = event.block.timestamp
    toHolder.save()
  }

  createTokenTransfer(
    event.transaction.hash.toHex(),
    event.params.from,
    event.params.to,
    event.params.value,
    event.block.timestamp,
    'osToken',
  )

  log.info('[OsToken] Transfer from={} to={} amount={}', [
    event.params.from.toHexString(),
    event.params.to.toHexString(),
    event.params.value.toString(),
  ])
}
