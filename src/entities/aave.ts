import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { Aave, AavePosition, OsToken } from '../../generated/schema'
import { AaveProtocolDataProvider as AaveProtocolDataProviderContract } from '../../generated/PeriodicTasks/AaveProtocolDataProvider'
import { AaveLeverageStrategy } from '../../generated/PeriodicTasks/AaveLeverageStrategy'
import {
  AAVE_LEVERAGE_STRATEGY,
  AAVE_PROTOCOL_DATA_PROVIDER,
  AAVE_PROTOCOL_DATA_PROVIDER_START_BLOCK,
  ASSET_TOKEN,
  OS_TOKEN,
  WAD,
} from '../helpers/constants'
import { calculateAverage, getCompoundedApy } from '../helpers/utils'
import { getOsTokenApy } from './osToken'

const aaveId = '1'
const snapshotsPerWeek = 168
const snapshotsPerDay = 24

export function loadAave(): Aave | null {
  return Aave.load(aaveId)
}

export function loadAavePosition(positionAddress: Address): AavePosition | null {
  return AavePosition.load(positionAddress.toHex())
}

export function createOrLoadAave(): Aave {
  let aave = Aave.load(aaveId)
  if (aave === null) {
    aave = new Aave(aaveId)
    aave.borrowApy = BigDecimal.zero()
    aave.supplyApy = BigDecimal.zero()
    aave.borrowApys = []
    aave.supplyApys = []
    aave.save()
  }

  return aave
}

export function createOrLoadAavePosition(userAddress: Address): AavePosition {
  const positionId = userAddress.toHex()
  let position = AavePosition.load(positionId)
  if (position === null) {
    position = new AavePosition(positionId)
    position.user = userAddress
    position.aave = aaveId
    position.suppliedOsTokenShares = BigInt.fromI32(0)
    position.borrowedAssets = BigInt.fromI32(0)
    position.save()
  }
  return position
}

export function updateAaveApys(aave: Aave, blockNumber: BigInt): void {
  if (
    AAVE_PROTOCOL_DATA_PROVIDER.equals(Address.zero()) ||
    blockNumber.lt(BigInt.fromString(AAVE_PROTOCOL_DATA_PROVIDER_START_BLOCK))
  ) {
    return
  }
  const wadToRayBigInt = BigInt.fromString('1000000000')
  const wad = BigDecimal.fromString(WAD)
  const maxPercent = BigDecimal.fromString('100')
  const aaveDataProviderContract = AaveProtocolDataProviderContract.bind(AAVE_PROTOCOL_DATA_PROVIDER)

  // fetch osToken supply rate
  const _response = aaveDataProviderContract.try_getReserveData(OS_TOKEN)
  if (_response.reverted) {
    log.error('[Aave] getReserveData reverted asset={}', [OS_TOKEN.toHex()])
    return
  }
  let response = _response.value
  const osTokenSupplyRate = response.getLiquidityRate().div(wadToRayBigInt)
  const supplyApy = osTokenSupplyRate.toBigDecimal().times(maxPercent).div(wad)

  // fetch asset token (e.g. WETH, GNO) borrow rate
  response = aaveDataProviderContract.getReserveData(Address.fromString(ASSET_TOKEN))
  const variableBorrowRate = response.getVariableBorrowRate().div(wadToRayBigInt)
  const borrowApy = variableBorrowRate.toBigDecimal().times(maxPercent).div(wad)

  let apys = aave.supplyApys
  apys.push(supplyApy)
  // assumes that updates happen every hour
  if (apys.length > snapshotsPerWeek) {
    apys = apys.slice(apys.length - snapshotsPerWeek)
  }
  aave.supplyApys = apys
  aave.supplyApy = calculateAverage(apys)
  aave.save()

  apys = aave.borrowApys
  apys.push(borrowApy)
  // assumes that updates happen every hour
  if (apys.length > snapshotsPerWeek) {
    apys = apys.slice(apys.length - snapshotsPerWeek)
  }
  aave.borrowApys = apys
  aave.borrowApy = calculateAverage(apys)
  aave.save()
}

export function updateAavePosition(position: AavePosition): void {
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY)
  const borrowState = aaveLeverageStrategy.getBorrowState(Address.fromBytes(position.user))
  position.borrowedAssets = borrowState.getBorrowedAssets()
  position.suppliedOsTokenShares = borrowState.getSuppliedOsTokenShares()
  position.save()
}

export function getAaveSupplyApy(aave: Aave, osToken: OsToken, useDayApy: boolean): BigDecimal {
  // assumes that updates happen every hour
  const apysCount = aave.supplyApys.length
  let apy: BigDecimal
  if (!useDayApy || apysCount < snapshotsPerDay) {
    apy = aave.supplyApy
  } else {
    const apys: Array<BigDecimal> = aave.supplyApys
    apy = calculateAverage(apys.slice(apysCount - snapshotsPerDay))
  }
  // earned osToken shares earn extra staking rewards, apply compounding
  return getCompoundedApy(apy, getOsTokenApy(osToken, useDayApy))
}

export function getAaveBorrowApy(aave: Aave, useDayApy: boolean): BigDecimal {
  // assumes that updates happen every hour
  const apysCount = aave.borrowApys.length
  if (!useDayApy || apysCount < snapshotsPerDay) {
    return aave.borrowApy
  }
  const apys: Array<BigDecimal> = aave.borrowApys
  return calculateAverage(apys.slice(apysCount - snapshotsPerDay))
}
