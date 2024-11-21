import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { ExitRequest, OsToken, OsTokenExitRequest, Vault } from '../../generated/schema'
import { convertOsTokenSharesToAssets, createOrLoadOsToken } from './osToken'
import { GENESIS_VAULT, OS_TOKEN_VAULT_ESCROW } from '../helpers/constants'
import { createOrLoadV2Pool } from './v2pool'
import { OsTokenVaultEscrow } from '../../generated/OsTokenVaultEscrow/OsTokenVaultEscrow'

export function createOrLoadOsTokenExitRequest(vault: Address, positionTicket: BigInt): OsTokenExitRequest {
  const exitRequestId = `${vault.toHex()}-${positionTicket.toString()}`
  let osTokenExitRequest = OsTokenExitRequest.load(exitRequestId)
  if (osTokenExitRequest == null) {
    osTokenExitRequest = new OsTokenExitRequest(exitRequestId)
    osTokenExitRequest.owner = Address.zero()
    osTokenExitRequest.vault = vault.toHex()
    osTokenExitRequest.positionTicket = positionTicket
    osTokenExitRequest.osTokenShares = BigInt.zero()
    osTokenExitRequest.ltv = BigDecimal.zero()
    osTokenExitRequest.save()
  }

  return osTokenExitRequest
}

export function getExitRequestLtv(osTokenExitRequest: OsTokenExitRequest, osToken: OsToken): BigDecimal {
  const mintedOsTokenAssets = convertOsTokenSharesToAssets(osToken, osTokenExitRequest.osTokenShares)

  // use processed assets if available
  let depositedAssets: BigInt
  if (osTokenExitRequest.exitedAssets !== null) {
    depositedAssets = osTokenExitRequest.exitedAssets as BigInt
  } else {
    const exitRequestId = `${osTokenExitRequest.vault}-${osTokenExitRequest.positionTicket.toString()}`
    const exitRequest = ExitRequest.load(exitRequestId) as ExitRequest
    depositedAssets = exitRequest.totalAssets
  }
  if (depositedAssets.isZero() || mintedOsTokenAssets.isZero()) {
    return BigDecimal.zero()
  }

  return mintedOsTokenAssets.divDecimal(depositedAssets.toBigDecimal())
}

export function updateOsTokenExitRequests(vault: Vault): void {
  if (Address.fromString(vault.id).equals(GENESIS_VAULT)) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      // wait for the migration
      return
    }
  }
  const osToken = createOrLoadOsToken()
  const vaultAddress = Address.fromString(vault.id)
  const osTokenVaultEscrow = OsTokenVaultEscrow.bind(OS_TOKEN_VAULT_ESCROW)

  let osTokenExitRequest: OsTokenExitRequest
  const osTokenExitRequests: Array<OsTokenExitRequest> = vault.osTokenExitRequests.load()
  for (let i = 0; i < osTokenExitRequests.length; i++) {
    osTokenExitRequest = osTokenExitRequests[i]
    if (osTokenExitRequest.osTokenShares.isZero()) {
      continue
    }
    const response = osTokenVaultEscrow.getPosition(vaultAddress, osTokenExitRequest.positionTicket)
    osTokenExitRequest.osTokenShares = response.getValue2()
    osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
    osTokenExitRequest.save()
  }
}
