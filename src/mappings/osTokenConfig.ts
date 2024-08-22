import { Address, log, BigInt } from '@graphprotocol/graph-ts'
import { Vault } from '../../generated/schema'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { OsTokenConfigUpdated as OsTokenConfigV1Updated } from '../../generated/OsTokenConfigV1/OsTokenConfigV1'
import { OsTokenConfigUpdated as OsTokenConfigV2Updated } from '../../generated/OsTokenConfigV2/OsTokenConfigV2'

export function updateDefaultOsTokenConfig(version: string, ltvPercent: BigInt, liqThresholdPercent: BigInt): void {
  const osTokenDefaultConfig = createOrLoadOsTokenConfig(version)

  osTokenDefaultConfig.ltvPercent = ltvPercent
  osTokenDefaultConfig.liqThresholdPercent = liqThresholdPercent

  osTokenDefaultConfig.save()

  log.info('[OsTokenConfig] OsTokenConfigUpdated version={} ltvPercent={} liqThresholdPercent={}', [
    version,
    ltvPercent.toString(),
    liqThresholdPercent.toString(),
  ])
}

export function handleOsTokenConfigV1Updated(event: OsTokenConfigV1Updated): void {
  const ltvPercent = event.params.ltvPercent
  const liqThresholdPercent = event.params.liqThresholdPercent

  const multiplier = BigInt.fromString('100000000000000')
  const modifiedLiqThresholdPercent = BigInt.fromI32(liqThresholdPercent).times(multiplier)

  updateDefaultOsTokenConfig('1', BigInt.fromI32(ltvPercent), modifiedLiqThresholdPercent)
}

export function handleOsTokenConfigV2Updated(event: OsTokenConfigV2Updated): void {
  const zeroAddress = Address.zero()
  const vaultAddress = event.params.vault.toHex()

  const ltvPercent = event.params.ltvPercent
  const liqThresholdPercent = event.params.liqThresholdPercent

  if (event.params.vault.equals(zeroAddress)) {
    updateDefaultOsTokenConfig('2', ltvPercent, liqThresholdPercent)
  } else {
    const vault = Vault.load(vaultAddress) as Vault

    vault.ltvPercent = ltvPercent
    vault.liqThresholdPercent = liqThresholdPercent

    vault.save()
  }

  log.info('[OsTokenConfig] OsTokenConfigV2Updated vault={} ltvPercent={} liqThresholdPercent={}', [
    vaultAddress,
    ltvPercent.toString(),
    liqThresholdPercent.toString(),
  ])
}
