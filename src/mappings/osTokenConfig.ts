import { Address, log, BigInt } from '@graphprotocol/graph-ts'
import { Vault } from '../../generated/schema'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { OsTokenConfigUpdated as OsTokenConfigV1Updated } from '../../generated/OsTokenConfigV1/OsTokenConfigV1'
import { OsTokenConfigUpdated as OsTokenConfigV2Updated } from '../../generated/OsTokenConfigV2/OsTokenConfigV2'
import { updateAllocatorsLtvStatus } from '../entities/allocator'

export function handleOsTokenConfigV1Updated(event: OsTokenConfigV1Updated): void {
  const ltvPercent = event.params.ltvPercent
  const liqThresholdPercent = event.params.liqThresholdPercent

  const multiplier = BigInt.fromString('100000000000000')
  updateOsTokenConfig(
    '1',
    BigInt.fromI32(ltvPercent).times(multiplier),
    BigInt.fromI32(liqThresholdPercent).times(multiplier),
  )
  updateAllocatorsLtvStatus()
}

export function handleOsTokenConfigV2Updated(event: OsTokenConfigV2Updated): void {
  const zeroAddress = Address.zero()
  const vaultAddress = event.params.vault.toHex()

  const ltvPercent = event.params.ltvPercent
  const liqThresholdPercent = event.params.liqThresholdPercent

  if (event.params.vault.equals(zeroAddress)) {
    updateOsTokenConfig('2', ltvPercent, liqThresholdPercent)
  } else {
    const vault = Vault.load(vaultAddress) as Vault
    const osTokenConfigId = `${vaultAddress}-2`

    updateOsTokenConfig(osTokenConfigId, ltvPercent, liqThresholdPercent)

    vault.osTokenConfig = osTokenConfigId

    vault.save()
  }
  updateAllocatorsLtvStatus()
}

function updateOsTokenConfig(version: string, ltvPercent: BigInt, liqThresholdPercent: BigInt): void {
  const osTokenConfig = createOrLoadOsTokenConfig(version)

  osTokenConfig.ltvPercent = ltvPercent
  osTokenConfig.liqThresholdPercent = liqThresholdPercent

  osTokenConfig.save()

  log.info('[OsTokenConfig] OsTokenConfigUpdated version={} ltvPercent={} liqThresholdPercent={}', [
    version,
    ltvPercent.toString(),
    liqThresholdPercent.toString(),
  ])
}
