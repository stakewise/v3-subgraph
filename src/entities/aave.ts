import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { Aave, AavePosition } from '../../generated/schema'
import { AaveProtocolDataProvider as AaveProtocolDataProviderContract } from '../../generated/Keeper/AaveProtocolDataProvider'
import { AaveLeverageStrategy } from '../../generated/AaveLeverageStrategyV1/AaveLeverageStrategy'
import {
  AAVE_LEVERAGE_STRATEGY_V1,
  AAVE_PROTOCOL_DATA_PROVIDER,
  AAVE_PROTOCOL_DATA_PROVIDER_START_BLOCK,
  ASSET_TOKEN,
  NETWORK,
  OS_TOKEN,
  WAD,
} from '../helpers/constants'
import { calculateAverage, chunkedMulticall, encodeContractCall } from '../helpers/utils'

const aaveId = '1'
const snapshotsPerWeek = 168
const getBorrowStateSelector = '0xe70631bc'
const MAX_UINT_256 = BigInt.fromString('115792089237316195423570985008687907853269984665640564039457584007913129639935')

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
    aave.leverageMaxBorrowLtvPercent = BigInt.zero()
    aave.borrowApys = []
    aave.supplyApys = []
    if (NETWORK == 'hoodi') {
      // OsToken supply cap cannot be set on Hoodi
      aave.osTokenSupplyCap = MAX_UINT_256
    } else {
      aave.osTokenSupplyCap = BigInt.zero()
    }
    aave.osTokenTotalSupplied = BigInt.zero()
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

export function updateAavePositions(aave: Aave): void {
  const positions: Array<AavePosition> = aave.positions.load()
  const positionsCount = positions.length

  let position: AavePosition
  const contractCalls: Array<ethereum.Value> = []
  for (let i = 0; i < positionsCount; i++) {
    position = positions[i]
    contractCalls.push(
      encodeContractCall(AAVE_LEVERAGE_STRATEGY_V1, _getBorrowStateCall(Address.fromBytes(position.user))),
    )
  }

  const result = chunkedMulticall(null, contractCalls)
  for (let i = 0; i < positionsCount; i++) {
    position = positions[i]
    let decodedResult = ethereum.decode('(uint256,uint256)', result[i]!)!.toTuple()
    position.borrowedAssets = decodedResult[0].toBigInt()
    position.suppliedOsTokenShares = decodedResult[1].toBigInt()
    position.save()
  }
}

export function updateAavePosition(position: AavePosition): void {
  const aaveLeverageStrategy = AaveLeverageStrategy.bind(AAVE_LEVERAGE_STRATEGY_V1)
  const borrowState = aaveLeverageStrategy.getBorrowState(Address.fromBytes(position.user))
  position.borrowedAssets = borrowState.getBorrowedAssets()
  position.suppliedOsTokenShares = borrowState.getSuppliedOsTokenShares()
  position.save()
}

function _getBorrowStateCall(user: Address): Bytes {
  const encodedGetBorrowStateArgs = ethereum.encode(ethereum.Value.fromAddress(user))
  return Bytes.fromHexString(getBorrowStateSelector).concat(encodedGetBorrowStateArgs!)
}
