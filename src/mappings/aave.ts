import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { OsTokenConfig, Vault } from '../../generated/schema'
import { AaveProtocolDataProvider as AaveProtocolDataProviderContract } from '../../generated/Aave/AaveProtocolDataProvider'
import { AAVE_PROTOCOL_DATA_PROVIDER, ASSET_TOKEN, OS_TOKEN, WAD } from '../helpers/constants'
import { convertAssetsToOsTokenShares, convertOsTokenSharesToAssets, createOrLoadOsToken } from '../entities/osToken'
import { createOrLoadNetwork } from '../entities/network'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { calculateMedian } from '../helpers/utils'
import { getAaveLeverageLtv, getVaultLeverageLtv } from '../entities/leverageStrategy'

const rayToWad = '1000000000'
const hoursInWeek = 168

export function handleVaultBoostApy(block: ethereum.Block): void {
  if (AAVE_PROTOCOL_DATA_PROVIDER.equals(Address.zero())) {
    return
  }
  const network = createOrLoadNetwork()
  const osToken = createOrLoadOsToken()
  const wad = BigInt.fromString(WAD)
  const rayToWadBigInt = BigInt.fromString(rayToWad)
  const initialDepositAssets = wad
  const aaveDataProviderContract = AaveProtocolDataProviderContract.bind(AAVE_PROTOCOL_DATA_PROVIDER)

  // fetch osToken supply rate
  let response = aaveDataProviderContract.getReserveData(OS_TOKEN)
  const osTokenSupplyRate = response.getLiquidityRate().div(rayToWadBigInt)

  // fetch asset token (e.g. WETH, GNO) borrow rate
  response = aaveDataProviderContract.getReserveData(Address.fromString(ASSET_TOKEN))
  const variableBorrowRate = response.getVariableBorrowRate().div(rayToWadBigInt)

  // fetch osToken LTV
  const aaveLeverageLtv = getAaveLeverageLtv()
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
  let osTokenConfig: OsTokenConfig
  let vaultLeverageLtv: BigInt, totalLtv: BigInt, vaultRate: BigInt, osTokenMintRate: BigInt
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    if (!vault.isOsTokenEnabled) {
      continue
    }
    vaultLeverageLtv = getVaultLeverageLtv(vault)
    osTokenConfig = createOrLoadOsTokenConfig(vault.osTokenConfig)
    totalLtv = vaultLeverageLtv.times(aaveLeverageLtv).div(wad)
    vaultRate = vault.apy.times(new BigDecimal(wad)).div(BigDecimal.fromString('100')).truncate(0).digits
    osTokenMintRate = osTokenRate
      .times(osTokenFeePercent)
      .times(wad)
      .div(BigInt.fromI32(10000).minus(osTokenFeePercent))
      .div(osTokenConfig.ltvPercent)

    // calculate assets and shares
    const initialMintedOsTokenAssets = initialDepositAssets.times(osTokenConfig.ltvPercent).div(wad)
    const initialMintedOsTokenShares = convertAssetsToOsTokenShares(osToken, initialMintedOsTokenAssets)
    const leverageMintedOsTokenShares = initialMintedOsTokenShares
      .times(wad)
      .div(wad.minus(totalLtv))
      .minus(initialMintedOsTokenShares)
    const leverageMintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, leverageMintedOsTokenShares)
    const leverageDepositedAssets = leverageMintedOsTokenAssets.times(wad).div(vaultLeverageLtv)

    // all deposited assets earn vault apy
    let totalEarnedAssets = initialDepositAssets.plus(leverageDepositedAssets).times(vaultRate).div(wad)

    // all minted osToken assets lose mint apy
    totalEarnedAssets = totalEarnedAssets.minus(
      initialMintedOsTokenAssets.plus(leverageMintedOsTokenAssets).times(osTokenMintRate).div(wad),
    )

    // all supplied osToken shares earn supply apy
    const earnedOsTokenShares = initialMintedOsTokenShares
      .plus(leverageMintedOsTokenShares)
      .times(osTokenSupplyRate)
      .div(wad)
    totalEarnedAssets = totalEarnedAssets.plus(
      convertOsTokenSharesToAssets(osToken, earnedOsTokenShares).times(osTokenRate).div(wad),
    )

    // all borrowed assets lose borrow apy
    totalEarnedAssets = totalEarnedAssets.minus(leverageDepositedAssets.times(variableBorrowRate).div(wad))

    // calculate and update max boost apy
    const currentApy = new BigDecimal(totalEarnedAssets)
      .times(BigDecimal.fromString('100'))
      .div(new BigDecimal(initialDepositAssets))
    let apys = vault.maxBoostApys
    apys.push(currentApy)
    if (apys.length > hoursInWeek) {
      apys = apys.slice(apys.length - hoursInWeek)
    }
    vault.maxBoostApys = apys
    vault.maxBoostApy = calculateMedian(apys)
    vault.save()
  }
  log.info('[Aave] Sync vault boost apys at block={}', [block.number.toString()])
}
