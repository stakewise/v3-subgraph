import { BigInt } from '@graphprotocol/graph-ts'
import { OsTokenConfig } from '../../generated/schema'

export function loadOsTokenConfig(version: string): OsTokenConfig | null {
  return OsTokenConfig.load(version)
}

export function createOrLoadOsTokenConfig(version: string): OsTokenConfig {
  let osTokenConfig = OsTokenConfig.load(version)
  if (osTokenConfig) {
    return osTokenConfig
  }

  osTokenConfig = new OsTokenConfig(version)
  if (version == '2') {
    const prevConfig = loadOsTokenConfig('1')
    if (prevConfig != null) {
      osTokenConfig.ltvPercent = prevConfig.ltvPercent
      osTokenConfig.liqThresholdPercent = prevConfig.liqThresholdPercent
    } else {
      osTokenConfig.ltvPercent = BigInt.zero()
      osTokenConfig.liqThresholdPercent = BigInt.zero()
    }
  } else {
    osTokenConfig.ltvPercent = BigInt.zero()
    osTokenConfig.liqThresholdPercent = BigInt.zero()
  }
  osTokenConfig.leverageMaxMintLtvPercent = BigInt.zero()
  osTokenConfig.save()

  return osTokenConfig
}
