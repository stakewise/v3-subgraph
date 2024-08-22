import { BigInt } from '@graphprotocol/graph-ts'
import { OsTokenDefaultConfig } from '../../generated/schema'

export function createOrLoadOsTokenDefaultConfig(version: string): OsTokenDefaultConfig {
  let osTokenConfig = OsTokenDefaultConfig.load(version)

  if (osTokenConfig == null) {
    osTokenConfig = new OsTokenDefaultConfig(version)
    osTokenConfig.ltvPercent = BigInt.zero()
    osTokenConfig.liqThresholdPercent = BigInt.zero()
    osTokenConfig.save()
  }

  return osTokenConfig
}
