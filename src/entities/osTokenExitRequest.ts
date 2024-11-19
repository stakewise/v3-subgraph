import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import {
  OsTokenExitRequest, Vault,
} from '../../generated/schema'
import {
  // createOrLoadOsToken,
  osTokenId,
} from './osToken'
import {GENESIS_VAULT} from "../helpers/constants";
import {createOrLoadV2Pool} from "./v2pool";


export function createOsTokenExitRequest(exitRequestId: string, vault: Address, owner: Address): OsTokenExitRequest {
  let osTokenExitRequest = OsTokenExitRequest.load(exitRequestId)
  if (osTokenExitRequest === null) {
    osTokenExitRequest = new OsTokenExitRequest(osTokenId)
    osTokenExitRequest.owner = owner
    osTokenExitRequest.vault = vault.toHex()
    osTokenExitRequest.exitRequest = exitRequestId
    osTokenExitRequest.exitedAssets = BigInt.zero()
    osTokenExitRequest.osTokenShares = BigInt.zero()
    osTokenExitRequest.ltv = BigDecimal.zero()
    osTokenExitRequest.save()
  }

  return osTokenExitRequest
}


export function updateOsTokenExitRequest(vault: Vault): void {
  if (Address.fromString(vault.id).equals(GENESIS_VAULT)) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      // wait for the migration
      return
    }
  }
  // const osToken = createOrLoadOsToken()

  let osTokenExitRequest: OsTokenExitRequest
  const osTokenExitRequests: Array<OsTokenExitRequest> = vault.osTokenExitRequests.load()
  for (let i = 0; i < osTokenExitRequests.length; i++) {
    osTokenExitRequest = osTokenExitRequests[i]
    osTokenExitRequest.save()


  }
}