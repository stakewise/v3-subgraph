import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { Network, OsToken, OsTokenHolder, OsTokenHolderSnapshot } from '../../generated/schema'
import { getAnnualReward } from '../helpers/utils'
import { convertOsTokenSharesToAssets, getOsTokenApy, osTokenId } from './osToken'
import { getBoostPositionAnnualReward, loadLeverageStrategyPosition } from './leverageStrategy'
import { loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { loadAave } from './aave'

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
  osTokenHolder: OsTokenHolder,
  useDayApy: boolean,
): BigDecimal {
  const osTokenApy = getOsTokenApy(osToken, useDayApy)

  let principalAssets = osTokenHolder.assets
  let totalEarnedAssets = getAnnualReward(principalAssets, osTokenApy)

  // check balances of leverage strategy positions
  const osTokenVaultIds = network.osTokenVaultIds
  for (let i = 0; i < osTokenVaultIds.length; i++) {
    const vaultAddress = Address.fromString(osTokenVaultIds[i])
    const vault = loadVault(vaultAddress)!
    const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
    const position = loadLeverageStrategyPosition(vaultAddress, Address.fromString(osTokenHolder.id))
    if (!position) {
      continue
    }
    const aave = loadAave()!
    principalAssets = principalAssets.plus(position.totalAssets)
    totalEarnedAssets = totalEarnedAssets.plus(
      getBoostPositionAnnualReward(osToken, aave, vault, osTokenConfig, position, useDayApy),
    )
    // we only take the first boosted position
    break
  }

  if (principalAssets.isZero()) {
    return BigDecimal.zero()
  }

  return totalEarnedAssets.divDecimal(principalAssets.toBigDecimal()).times(BigDecimal.fromString('100'))
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
  osTokenHolder: OsTokenHolder,
  earnedAssets: BigInt,
  timestamp: BigInt,
): void {
  const snapshot = new OsTokenHolderSnapshot(timestamp.toString())
  snapshot.timestamp = timestamp.toI64()
  snapshot.osTokenHolder = osTokenHolder.id
  snapshot.earnedAssets = earnedAssets
  snapshot.totalAssets = osTokenHolder.assets
  snapshot.apy = getOsTokenHolderApy(network, osToken, osTokenHolder, true)
  snapshot.save()
}
