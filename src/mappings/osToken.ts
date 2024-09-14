import { log } from '@graphprotocol/graph-ts'
import {
  AvgRewardPerSecondUpdated,
  FeePercentUpdated,
  StateUpdated,
} from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { createOrLoadOsToken, updateOsTokenApy } from '../entities/osToken'

export function handleAvgRewardPerSecondUpdated(event: AvgRewardPerSecondUpdated): void {
  const newAvgRewardPerSecond = event.params.avgRewardPerSecond
  const osToken = createOrLoadOsToken()

  // update OsToken
  updateOsTokenApy(osToken, newAvgRewardPerSecond)
  osToken.save()

  log.info('[OsTokenController] AvgRewardPerSecondUpdated avgRewardPerSecond={}', [newAvgRewardPerSecond.toString()])
}

export function handleStateUpdated(event: StateUpdated): void {
  const shares = event.params.treasuryShares
  const assets = event.params.treasuryAssets
  const osToken = createOrLoadOsToken()
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.totalAssets = osToken.totalAssets.plus(assets)
  osToken.save()

  log.info('[OsTokenController] StateUpdated treasuryShares={}', [shares.toString()])
}

export function handleFeePercentUpdated(event: FeePercentUpdated): void {
  const osToken = createOrLoadOsToken()
  osToken.feePercent = event.params.feePercent
  osToken.save()

  log.info('[OsTokenController] FeePercentUpdated feePercent={}', [event.params.feePercent.toString()])
}
