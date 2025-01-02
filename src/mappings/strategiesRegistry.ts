import { StrategyConfigUpdated } from '../../generated/StrategiesRegistry/StrategiesRegistry'
import { Address, ethereum, log } from '@graphprotocol/graph-ts'
import { loadAave } from '../entities/aave'
import { loadOsTokenConfig } from '../entities/osTokenConfig'
import { loadNetwork } from '../entities/network'
import { loadVault } from '../entities/vault'

export function handleStrategyConfigUpdated(event: StrategyConfigUpdated): void {
  const configName = event.params.configName
  const value = event.params.value

  if (configName == 'leverageMaxBorrowLtvPercent') {
    const aave = loadAave()!
    aave.leverageMaxBorrowLtvPercent = ethereum.decode('uint256', value)!.toBigInt()
    aave.save()
  } else if (configName == 'maxVaultLtvPercent') {
    const leverageMaxMinLtvPercent = ethereum.decode('uint256', value)!.toBigInt()
    let osTokenConfig = loadOsTokenConfig('2')!
    osTokenConfig.leverageMaxMintLtvPercent = leverageMaxMinLtvPercent
    osTokenConfig.save()

    const network = loadNetwork()!
    const vaultIds = network.osTokenVaultIds
    for (let i = 0; i < vaultIds.length; i++) {
      const vault = loadVault(Address.fromString(vaultIds[i]))!
      if (vault.osTokenConfig != '1' && vault.osTokenConfig != '2') {
        osTokenConfig = loadOsTokenConfig(vault.osTokenConfig)!
        osTokenConfig.leverageMaxMintLtvPercent = leverageMaxMinLtvPercent
        osTokenConfig.save()
      }
    }
  }

  log.info('[StrategiesRegistry] StrategyConfigUpdated configName={}', [configName])
}
