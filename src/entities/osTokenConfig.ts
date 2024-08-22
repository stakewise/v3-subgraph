import { BigInt } from '@graphprotocol/graph-ts'
import { OsTokenConfig } from '../../generated/schema'

export function createOrLoadOsTokenConfig(version: string): OsTokenConfig {
  let osTokenConfig = OsTokenConfig.load(version)

  if (osTokenConfig == null) {
    osTokenConfig = new OsTokenConfig(version)
    osTokenConfig.ltvPercent = BigInt.zero()
    osTokenConfig.liqThresholdPercent = BigInt.zero()
    osTokenConfig.save()
  }

  return osTokenConfig
}
