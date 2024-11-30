import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { OsTokenConfig, Vault } from '../../generated/schema'
import { AaveProtocolDataProvider as AaveProtocolDataProviderContract } from '../../generated/Aave/AaveProtocolDataProvider'
import { AaveLeverageStrategy as AaveLeverageStrategyContract } from '../../generated/Aave/AaveLeverageStrategy'
import { AAVE_LEVERAGE_STRATEGY, AAVE_PROTOCOL_DATA_PROVIDER, ASSET_TOKEN, OS_TOKEN, WAD } from '../helpers/constants'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, createOrLoadOsToken } from '../entities/osToken'
import { createOrLoadNetwork } from '../entities/network'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { calculateAverage } from '../helpers/utils'

const wadToRay = '1000000000'
const hoursInWeek = 168

export function handleVaultBoostApy(block: ethereum.Block): void {
  if (AAVE_PROTOCOL_DATA_PROVIDER.equals(Address.zero()) || AAVE_LEVERAGE_STRATEGY.equals(Address.zero())) {
    return
  }
  const aaveDataProviderContract = AaveProtocolDataProviderContract.bind(AAVE_PROTOCOL_DATA_PROVIDER)
  const aaveLeverageStrategyContract = AaveLeverageStrategyContract.bind(AAVE_LEVERAGE_STRATEGY)

  const network = createOrLoadNetwork()
  const osToken = createOrLoadOsToken()
  const wad = BigInt.fromString(WAD)
  const wadToRayBigInt = BigInt.fromString(wadToRay)

  // fetch osToken supply rate
  let reserveData = aaveDataProviderContract.getReserveData(OS_TOKEN)
  const osTokenSupplyRate = reserveData.getLiquidityRate().div(wadToRayBigInt)

  // fetch asset token (e.g. WETH, GNO) borrow rate
  reserveData = aaveDataProviderContract.getReserveData(Address.fromString(ASSET_TOKEN))
  const variableBorrowRate = reserveData.getVariableBorrowRate().div(wadToRayBigInt)

  // fetch borrow LTV
  const aaveLeverageLtv = aaveLeverageStrategyContract.getBorrowLtv()
  log.info('[Aave] Fetched Aave parameters osTokenSupplyRate={}, variableBorrowRate={}, aaveLtv={} at block={}', [
    osTokenSupplyRate.toString(),
    variableBorrowRate.toString(),
    aaveLeverageLtv.toString(),
    block.number.toString(),
  ])

  // fetch osToken mint rate
  const osTokenFeePercent = BigInt.fromI32(osToken.feePercent)
  const osTokenRate = osToken.apy.times(new BigDecimal(wad)).div(BigDecimal.fromString('100')).truncate(0).digits

  let vault: Vault
  let vaultAddress: Address
  let osTokenConfig: OsTokenConfig
  let vaultLeverageLtv: BigInt, vaultRate: BigInt, osTokenMintRate: BigInt
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    if (!vault.isOsTokenEnabled) {
      continue
    }
    vaultAddress = Address.fromString(vault.id)
    vaultLeverageLtv = aaveLeverageStrategyContract.getVaultLtv(vaultAddress)
    osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)

    // calculate vault staking rate and the rate paid for minting osToken
    vaultRate = vault.apy.times(new BigDecimal(wad)).div(BigDecimal.fromString('100')).truncate(0).digits
    osTokenMintRate = osTokenRate
      .times(osTokenFeePercent)
      .times(wad)
      .div(BigInt.fromI32(10000).minus(osTokenFeePercent))
      .div(vaultLeverageLtv)

    // calculate max boost apy for vault allocator
    const allocatorDepositedAssets = wad

    // allocator mints max osToken shares
    const allocatorMintedOsTokenAssets = allocatorDepositedAssets.times(osTokenConfig.ltvPercent).div(wad)
    const allocatorMintedOsTokenShares = convertAssetsToOsTokenShares(osToken, allocatorMintedOsTokenAssets)

    // osTokenHolder deposits all osToken shares
    const osTokenHolderOsTokenAssets = allocatorMintedOsTokenAssets
    const osTokenHolderOsTokenShares = allocatorMintedOsTokenShares

    // calculate assets/shares boosted from the strategy
    const strategyMintedOsTokenShares = aaveLeverageStrategyContract.getFlashloanOsTokenShares(
      vaultAddress,
      osTokenHolderOsTokenShares,
    )
    const strategyMintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, strategyMintedOsTokenShares)
    const strategyDepositedAssets = strategyMintedOsTokenAssets.times(wad).div(vaultLeverageLtv)

    // calculate earned assets from staking
    let allocatorEarnedAssets = allocatorDepositedAssets.plus(strategyDepositedAssets).times(vaultRate).div(wad)
    let osTokenHolderEarnedAssets = osTokenHolderOsTokenAssets
      .times(osTokenRate)
      .div(wad)
      .plus(strategyDepositedAssets.times(vaultRate).div(wad))

    // subtract apy lost on minting osToken
    allocatorEarnedAssets = allocatorEarnedAssets.minus(
      allocatorMintedOsTokenAssets.plus(strategyMintedOsTokenAssets).times(osTokenMintRate).div(wad),
    )
    osTokenHolderEarnedAssets = osTokenHolderEarnedAssets.minus(
      strategyMintedOsTokenAssets.times(osTokenMintRate).div(wad),
    )

    // all supplied osToken shares earn supply apy
    const allocatorEarnedOsTokenShares = allocatorMintedOsTokenShares
      .plus(strategyMintedOsTokenShares)
      .times(osTokenSupplyRate)
      .div(wad)
    allocatorEarnedAssets = allocatorEarnedAssets.plus(
      convertOsTokenSharesToAssets(osToken, allocatorEarnedOsTokenShares),
    )
    const osTokenHolderEarnedOsTokenShares = osTokenHolderOsTokenShares
      .plus(strategyMintedOsTokenShares)
      .times(osTokenSupplyRate)
      .div(wad)
    osTokenHolderEarnedAssets = osTokenHolderEarnedAssets.plus(
      convertOsTokenSharesToAssets(osToken, osTokenHolderEarnedOsTokenShares),
    )

    // all borrowed assets lose borrow apy
    const borrowInterestAssets = strategyDepositedAssets.times(variableBorrowRate).div(wad)
    allocatorEarnedAssets = allocatorEarnedAssets.minus(borrowInterestAssets)
    osTokenHolderEarnedAssets = osTokenHolderEarnedAssets.minus(borrowInterestAssets)

    // update average allocator max boost APY
    const allocatorMaxBoostApy = new BigDecimal(allocatorEarnedAssets)
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(allocatorDepositedAssets))
    let apys = vault.allocatorMaxBoostApys
    apys.push(allocatorMaxBoostApy)
    if (apys.length > hoursInWeek) {
      apys = apys.slice(apys.length - hoursInWeek)
    }
    vault.allocatorMaxBoostApys = apys
    vault.allocatorMaxBoostApy = calculateAverage(apys)

    // update average osToken holder APY
    const osTokenHolderCurrentApy = new BigDecimal(osTokenHolderEarnedAssets)
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(osTokenHolderOsTokenAssets))
    apys = vault.osTokenHolderMaxBoostApys
    apys.push(osTokenHolderCurrentApy)
    if (apys.length > hoursInWeek) {
      apys = apys.slice(apys.length - hoursInWeek)
    }
    vault.osTokenHolderMaxBoostApys = apys
    vault.osTokenHolderMaxBoostApy = calculateAverage(apys)
    vault.save()
  }
  log.info('[Aave] Sync vault boost apys at block={}', [block.number.toString()])
}
