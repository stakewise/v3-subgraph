import { Address, BigDecimal, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { Staker, StakerSnapshot } from '../../generated/schema'
import { MAIN_META_VAULT } from '../helpers/constants'
import { loadAllocator, getAllocatorApy, getAllocatorAssets } from './allocator'
import { loadOsToken } from './osToken'
import { loadVault } from './vault'
import { loadOsTokenConfig } from './osTokenConfig'
import { loadAave } from './aave'
import { calculateApy, getSnapshotTimestamp } from '../helpers/utils'

export function loadStaker(stakerAddress: Address): Staker | null {
  return Staker.load(stakerAddress.toHex())
}

export function createOrLoadStaker(stakerAddress: Address): Staker {
  const stakerId = stakerAddress.toHex()
  let staker = Staker.load(stakerId)
  if (staker === null) {
    staker = new Staker(stakerId)
    staker.address = stakerAddress
    staker.totalAssets = BigInt.zero()
    staker.apy = BigDecimal.zero()
    staker.totalEarnedAssets = BigInt.zero()
    staker._periodDepositedAssets = BigInt.zero()
    staker._periodWithdrawnAssets = BigInt.zero()
    staker._prevSnapshotAssets = null
    staker.save()
  }
  return staker
}

export function updateStaker(stakerAddress: Address): void {
  const mainMetaVaultAddress = Address.fromString(MAIN_META_VAULT)
  const allocator = loadAllocator(stakerAddress, mainMetaVaultAddress)
  if (allocator === null) {
    return
  }

  const vault = loadVault(mainMetaVaultAddress)
  if (vault === null) {
    return
  }

  const osToken = loadOsToken()
  if (osToken === null) {
    return
  }

  const osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)
  if (osTokenConfig === null) {
    return
  }

  const aave = loadAave()
  if (aave === null) {
    return
  }

  const staker = createOrLoadStaker(stakerAddress)
  staker.totalAssets = getAllocatorAssets(osToken, osTokenConfig, allocator, true)
  if (staker.totalAssets.gt(BigInt.zero())) {
    staker.apy = getAllocatorApy(aave, osToken, osTokenConfig, vault, allocator, true)
  } else {
    staker.apy = BigDecimal.zero()
  }
  staker.save()
}

export function isMainMetaVault(vaultAddress: Address): boolean {
  return vaultAddress.equals(Address.fromString(MAIN_META_VAULT))
}

export function increaseStakerDepositedAssets(stakerAddress: Address, assets: BigInt): void {
  const staker = loadStaker(stakerAddress)
  if (staker !== null) {
    staker._periodDepositedAssets = staker._periodDepositedAssets.plus(assets)
    staker.save()
  }
}

export function increaseStakerWithdrawnAssets(stakerAddress: Address, assets: BigInt): void {
  const staker = loadStaker(stakerAddress)
  if (staker !== null) {
    staker._periodWithdrawnAssets = staker._periodWithdrawnAssets.plus(assets)
    staker.save()
  }
}

export function createStakerSnapshot(staker: Staker, duration: BigInt, timestamp: i64): void {
  // Skip if no previous snapshot data
  if (staker._prevSnapshotAssets === null) {
    staker._prevSnapshotAssets = staker.totalAssets
    staker._periodDepositedAssets = BigInt.zero()
    staker._periodWithdrawnAssets = BigInt.zero()
    staker.save()
    return
  }

  const snapshotTimestamp = getSnapshotTimestamp(timestamp)
  const snapshotId = staker.address.concat(Bytes.fromByteArray(Bytes.fromI64(snapshotTimestamp)))

  const snapshot = new StakerSnapshot(snapshotId)
  snapshot.timestamp = snapshotTimestamp
  snapshot.staker = staker.id
  snapshot.totalAssets = staker.totalAssets

  // earnedAssets = totalAssets change - net deposits (can be negative for penalties)
  const totalAssetsChange = staker.totalAssets.minus(staker._prevSnapshotAssets!)
  const netDeposits = staker._periodDepositedAssets.minus(staker._periodWithdrawnAssets)
  snapshot.earnedAssets = totalAssetsChange.minus(netDeposits)

  // APY calculation
  const startingAssets = staker._prevSnapshotAssets!
  snapshot.apy = calculateApy(snapshot.earnedAssets, startingAssets, duration)
  snapshot.save()

  // Update staker totals and reset period accumulators
  staker.totalEarnedAssets = staker.totalEarnedAssets.plus(snapshot.earnedAssets)
  staker._prevSnapshotAssets = staker.totalAssets
  staker._periodDepositedAssets = BigInt.zero()
  staker._periodWithdrawnAssets = BigInt.zero()
  staker.save()
}
