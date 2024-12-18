import { log } from '@graphprotocol/graph-ts'
import { FeePercentUpdated, StateUpdated } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import { convertOsTokenSharesToAssets, createOrLoadOsToken, loadOsToken } from '../entities/osToken'

export function handleStateUpdated(event: StateUpdated): void {
  const shares = event.params.treasuryShares
  const osToken = loadOsToken()!
  osToken.totalAssets = osToken.totalAssets.plus(convertOsTokenSharesToAssets(osToken, shares))
  osToken.totalSupply = osToken.totalSupply.plus(shares)
  osToken.save()

  log.info('[OsTokenController] StateUpdated treasuryShares={}', [shares.toString()])
}

export function handleFeePercentUpdated(event: FeePercentUpdated): void {
  const osToken = createOrLoadOsToken()
  osToken.feePercent = event.params.feePercent
  osToken.save()

  log.info('[OsTokenController] FeePercentUpdated feePercent={}', [event.params.feePercent.toString()])
}
