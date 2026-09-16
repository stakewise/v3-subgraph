import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { FeePercentUpdated, StateUpdated } from '../../generated/OsTokenVaultController/OsTokenVaultController'
import {
  convertOsTokenSharesToAssets,
  createOrLoadOsToken,
  loadOsToken,
  updateOsTokenTotalAssets,
} from '../entities/osToken'
import { CheckpointType, createOrLoadCheckpoint } from '../entities/checkpoint'
import { loadNetwork } from '../entities/network'
import { OsTokenConfig, Vault } from '../../generated/schema'
import { loadVault } from '../entities/vault'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { updateAllocatorMintedOsTokenShares } from '../entities/allocator'
import { updateOsTokenExitRequests } from '../entities/osTokenVaultEscrow'

const secondsInDay = 86400
const extraSecondsGap = 60

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

export function syncOsToken(block: ethereum.Block): void {
  const osToken = loadOsToken()
  const network = loadNetwork()
  if (!network || !osToken) {
    log.warning('[SyncOsToken] OsToken or Network not found', [])
    return
  }

  const newTimestamp = block.timestamp
  const osTokenCheckpoint = createOrLoadCheckpoint(CheckpointType.OS_TOKEN)
  const hasHourPassed = osTokenCheckpoint.timestamp.plus(BigInt.fromI32(3600)).lt(newTimestamp)
  const isCloseToDayEnd = newTimestamp
    .plus(BigInt.fromI32(extraSecondsGap))
    .div(BigInt.fromI32(secondsInDay))
    .gt(osTokenCheckpoint.timestamp.plus(BigInt.fromI32(extraSecondsGap)).div(BigInt.fromI32(secondsInDay)))

  if (!(hasHourPassed || isCloseToDayEnd)) {
    // update OsToken only once per hour or close to day end
    return
  }

  // update OsToken total assets
  updateOsTokenTotalAssets(osToken)

  let vault: Vault
  let osTokenConfig: OsTokenConfig | null
  const vaultIds = network.vaultIds
  const totalVaults = vaultIds.length
  for (let i = 0; i < totalVaults; i++) {
    vault = loadVault(Address.fromString(vaultIds[i]))!
    if (!vault.isOsTokenEnabled) {
      continue
    }

    osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)
    if (!osTokenConfig) {
      log.warning('[SyncOsToken] OsTokenConfig not found vault={} osTokenConfig={}', [vault.id, vault.osTokenConfig])
      continue
    }

    // update allocators minted osToken shares
    updateAllocatorMintedOsTokenShares(osToken, osTokenConfig, vault)

    // update OsToken exit requests
    updateOsTokenExitRequests(osToken, vault)
  }

  osTokenCheckpoint.timestamp = newTimestamp
  osTokenCheckpoint.save()

  log.info('[SyncOsToken] OsToken synced totalAssets={} timestamp={} vaults={}', [
    osToken.totalAssets.toString(),
    newTimestamp.toString(),
    totalVaults.toString(),
  ])
}
