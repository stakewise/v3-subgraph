import { Address, BigDecimal, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { OsToken, OsTokenExitRequest, Vault } from '../../generated/schema'
import { convertOsTokenSharesToAssets } from './osToken'
import { OS_TOKEN_VAULT_ESCROW } from '../helpers/constants'
import { loadV2Pool } from './v2pool'
import { loadExitRequest } from './exitRequest'
import { getUpdateStateCalls } from './vault'
import { chunkedMulticall, encodeContractCall } from '../helpers/utils'

const getPositionSelector = '0x3adbb5af'

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
    depositedAssets = osTokenExitRequest.exitedAssets!
  } else {
    const exitRequest = loadExitRequest(
      Address.fromString(osTokenExitRequest.vault),
      osTokenExitRequest.positionTicket,
    )!
    depositedAssets = exitRequest.totalAssets
  }
  if (depositedAssets.isZero() || mintedOsTokenAssets.isZero()) {
    return BigDecimal.zero()
  }

  return mintedOsTokenAssets.divDecimal(depositedAssets.toBigDecimal())
}

export function updateOsTokenExitRequests(osToken: OsToken, vault: Vault): void {
  if (vault.isGenesis && !loadV2Pool()!.migrated) {
    // wait for the migration
    return
  }
  const vaultAddress = Address.fromString(vault.id)
  const updateStateCalls = getUpdateStateCalls(vault)

  const contractCalls: Array<ethereum.Value> = []
  let osTokenExitRequest: OsTokenExitRequest
  const osTokenExitRequests: Array<OsTokenExitRequest> = vault.osTokenExitRequests.load()
  const unprocessedExitRequests: Array<OsTokenExitRequest> = []
  for (let i = 0; i < osTokenExitRequests.length; i++) {
    osTokenExitRequest = osTokenExitRequests[i]
    if (osTokenExitRequest.osTokenShares.isZero()) {
      continue
    }
    unprocessedExitRequests.push(osTokenExitRequest)
    contractCalls.push(
      encodeContractCall(OS_TOKEN_VAULT_ESCROW, _getPositionCall(vaultAddress, osTokenExitRequest.positionTicket)),
    )
  }
  if (unprocessedExitRequests.length == 0) {
    return
  }

  let result = chunkedMulticall(updateStateCalls, contractCalls, true, 100)

  // process result
  for (let i = 0; i < unprocessedExitRequests.length; i++) {
    osTokenExitRequest = unprocessedExitRequests[i]
    let decodedResult = ethereum.decode('(address,uint256,uint256)', result[i]!)!.toTuple()
    osTokenExitRequest.osTokenShares = decodedResult[2].toBigInt()
    osTokenExitRequest.ltv = getExitRequestLtv(osTokenExitRequest, osToken)
    osTokenExitRequest.save()
  }
}

function _getPositionCall(vault: Address, positionTicket: BigInt): Bytes {
  const positionCallArray: Array<ethereum.Value> = [
    ethereum.Value.fromAddress(vault),
    ethereum.Value.fromUnsignedBigInt(positionTicket),
  ]
  // Encode the tuple
  const encodedPositionCallArgs = ethereum.encode(
    ethereum.Value.fromTuple(changetype<ethereum.Tuple>(positionCallArray)),
  )
  return Bytes.fromHexString(getPositionSelector).concat(encodedPositionCallArgs!)
}
