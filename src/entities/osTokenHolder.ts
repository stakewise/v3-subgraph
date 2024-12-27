import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import {
  Allocator,
  Distributor,
  ExitRequest,
  LeverageStrategyPosition,
  Network,
  OsToken,
  OsTokenHolder,
  OsTokenHolderSnapshot,
  Vault,
} from '../../generated/schema'
import { getAnnualReward } from '../helpers/utils'
import { convertOsTokenSharesToAssets, getOsTokenApy, osTokenId } from './osToken'
import { getBoostPositionAnnualReward, loadLeverageStrategyPosition } from './leverageStrategy'
import { loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { loadAave } from './aave'
import { loadAllocator } from './allocator'

export function loadOsTokenHolder(holderAddress: Address): OsTokenHolder | null {
  return OsTokenHolder.load(holderAddress.toHex())
}

export function createOrLoadOsTokenHolder(holderAddress: Address): OsTokenHolder {
  const id = holderAddress.toHex()
  let holder = OsTokenHolder.load(id)

  if (holder === null) {
    holder = new OsTokenHolder(id)
    holder.balance = BigInt.zero()
    holder.assets = BigInt.zero()
    holder.osToken = osTokenId
    holder.transfersCount = BigInt.zero()
    holder.apy = BigDecimal.zero()
    holder.save()
  }

  return holder
}

export function getOsTokenHolderApy(
  network: Network,
  osToken: OsToken,
  distributor: Distributor,
  osTokenHolder: OsTokenHolder,
  useDayApy: boolean,
): BigDecimal {
  const osTokenApy = getOsTokenApy(osToken, useDayApy)

  let principalAssets = osTokenHolder.assets
  let totalEarnedAssets = getAnnualReward(principalAssets, osTokenApy)

  // check balances of leverage strategy positions
  let vault: Vault | null = null
  const osTokenVaultIds = network.osTokenVaultIds
  for (let i = 0; i < osTokenVaultIds.length; i++) {
    const vaultAddress = Address.fromString(osTokenVaultIds[i])
    const position = loadLeverageStrategyPosition(vaultAddress, Address.fromString(osTokenHolder.id))
    if (!position) {
      continue
    }
    vault = loadVault(vaultAddress)!
    const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
    const aave = loadAave()!
    principalAssets = principalAssets.plus(position.totalAssets)
    totalEarnedAssets = totalEarnedAssets.plus(
      getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, position, distributor, useDayApy),
    )
    // we only take the first boosted position
    break
  }

  if (principalAssets.isZero()) {
    return BigDecimal.zero()
  }

  const osTokenHolderApy = totalEarnedAssets
    .divDecimal(principalAssets.toBigDecimal())
    .times(BigDecimal.fromString('100'))
  if (
    !useDayApy &&
    vault &&
    osTokenApy.lt(vault.osTokenHolderMaxBoostApy) &&
    osTokenHolderApy.gt(vault.osTokenHolderMaxBoostApy)
  ) {
    log.warning(
      '[getOsTokenHolderApy] Calculated APY is higher than max boost APY: maxBoostApy={} osTokenHolderApy={} vault={} holder={}',
      [vault.osTokenHolderMaxBoostApy.toString(), osTokenHolderApy.toString(), vault.id, osTokenHolder.id],
    )
    return vault.osTokenHolderMaxBoostApy
  }
  return osTokenHolderApy
}

export function getOsTokenHolderTotalAssets(network: Network, osToken: OsToken, osTokenHolder: OsTokenHolder): BigInt {
  const osTokenHolderAddress = Address.fromString(osTokenHolder.id)
  let totalAssets = osTokenHolder.assets

  // find OsToken holder vault
  let vaultAddress: Address
  let allocator: Allocator | null = null
  let boostPosition: LeverageStrategyPosition | null = null
  const osTokenVaultIds = network.osTokenVaultIds
  for (let i = 0; i < osTokenVaultIds.length; i++) {
    vaultAddress = Address.fromString(osTokenVaultIds[i])
    allocator = loadAllocator(osTokenHolderAddress, vaultAddress)
    boostPosition = loadLeverageStrategyPosition(vaultAddress, osTokenHolderAddress)

    if (allocator || boostPosition) {
      break
    }
  }

  // add assets in all unclaimed exit requests
  if (allocator) {
    let exitRequest: ExitRequest
    const exitRequests = allocator.exitRequests.load()
    for (let i = 0; i < exitRequests.length; i++) {
      exitRequest = exitRequests[i]
      if (
        !exitRequest.isClaimed &&
        Address.fromBytes(exitRequest.receiver).equals(Address.fromBytes(allocator.address))
      ) {
        totalAssets = totalAssets.plus(exitRequest.totalAssets)
      }
    }
  }

  // add boost position assets
  if (boostPosition) {
    totalAssets = totalAssets
      .plus(boostPosition.assets)
      .plus(convertOsTokenSharesToAssets(osToken, boostPosition.osTokenShares))
  }

  return totalAssets
}

export function updateOsTokenHolderAssets(osToken: OsToken, osTokenHolder: OsTokenHolder): BigInt {
  const assetsBefore = osTokenHolder.assets
  osTokenHolder.assets = convertOsTokenSharesToAssets(osToken, osTokenHolder.balance)
  osTokenHolder.save()
  return osTokenHolder.assets.minus(assetsBefore)
}

export function snapshotOsTokenHolder(
  network: Network,
  osToken: OsToken,
  distributor: Distributor,
  osTokenHolder: OsTokenHolder,
  earnedAssets: BigInt,
  timestamp: BigInt,
): void {
  const snapshot = new OsTokenHolderSnapshot(timestamp.toString())
  snapshot.timestamp = timestamp.toI64()
  snapshot.osTokenHolder = osTokenHolder.id
  snapshot.earnedAssets = earnedAssets
  snapshot.totalAssets = getOsTokenHolderTotalAssets(network, osToken, osTokenHolder)
  snapshot.apy = getOsTokenHolderApy(network, osToken, distributor, osTokenHolder, true)
  snapshot.save()
}
