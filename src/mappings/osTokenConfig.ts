import { Address, BigInt, log } from '@graphprotocol/graph-ts'
import { OsTokenConfigUpdated as OsTokenConfigV1Updated } from '../../generated/OsTokenConfigV1/OsTokenConfigV1'
import { OsTokenConfigUpdated as OsTokenConfigV2Updated } from '../../generated/OsTokenConfigV2/OsTokenConfigV2'
import { updateAllocatorsLtvStatus } from '../entities/allocator'
import { createOrLoadOsTokenConfig } from '../entities/osTokenConfig'
import { loadVault } from '../entities/vault'
import { Vault } from '../../generated/schema'

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
  const vaultAddress = event.params.vault

  const ltvPercent = event.params.ltvPercent
  const liqThresholdPercent = event.params.liqThresholdPercent

  if (vaultAddress.equals(Address.zero())) {
    updateOsTokenConfig('2', ltvPercent, liqThresholdPercent)
  } else {
    const vault = loadVault(vaultAddress)!
    const osTokenConfigId = vaultAddress.toHex()

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

  if (Vault.load(version) !== null) {
    // vault specific config
    osTokenConfig.leverageMaxMintLtvPercent = createOrLoadOsTokenConfig('2').leverageMaxMintLtvPercent
  }
  osTokenConfig.save()

  log.info('[OsTokenConfig] OsTokenConfigUpdated version={} ltvPercent={} liqThresholdPercent={}', [
    version,
    ltvPercent.toString(),
    liqThresholdPercent.toString(),
  ])
}
