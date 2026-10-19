import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts'

import { OsTokenRedeemer, OsTokenRedeemerExitRequest } from '../../generated/schema'
import { OsTokenRedeemer as OsTokenRedeemerContract } from '../../generated/OsTokenRedeemerV1/OsTokenRedeemer'
import { OS_TOKEN_REDEEMER_V1 } from '../helpers/constants'
import { convertOsTokenSharesToAssets, loadOsToken } from './osToken'

export function loadOsTokenRedeemer(redeemerAddress: Address): OsTokenRedeemer | null {
  return OsTokenRedeemer.load(redeemerAddress.toHex())
}

export function createOrLoadOsTokenRedeemer(redeemerAddress: Address): OsTokenRedeemer {
  const id = redeemerAddress.toHex()
  let osTokenRedeemer = OsTokenRedeemer.load(id)

  if (osTokenRedeemer === null) {
    osTokenRedeemer = new OsTokenRedeemer(id)
    // the V1 redeemer is deprecated: it is indexed only so that pending exit requests can be claimed
    osTokenRedeemer.isActive = !redeemerAddress.equals(OS_TOKEN_REDEEMER_V1)
    osTokenRedeemer.merkleRoot = Bytes.empty()
    osTokenRedeemer.ipfsHash = ''
    osTokenRedeemer.save()
  }

  return osTokenRedeemer
}

export function getRedeemablePositionId(redeemerAddress: Address, vaultAddress: Address, owner: Address): string {
  return `${redeemerAddress.toHex()}-${vaultAddress.toHex()}-${owner.toHex()}`
}

export function getOsTokenRedeemerExitRequestId(redeemerAddress: Address, positionTicket: BigInt): string {
  return `${redeemerAddress.toHex()}-${positionTicket.toString()}`
}

export function createOsTokenRedeemerExitRequest(
  redeemerAddress: Address,
  owner: Address,
  receiver: Address,
  positionTicket: BigInt,
  shares: BigInt,
  timestamp: BigInt,
): OsTokenRedeemerExitRequest {
  const osToken = loadOsToken()!
  const osTokenRedeemer = createOrLoadOsTokenRedeemer(redeemerAddress)
  const exitRequest = new OsTokenRedeemerExitRequest(getOsTokenRedeemerExitRequestId(redeemerAddress, positionTicket))

  exitRequest.owner = owner
  exitRequest.isClaimed = false
  exitRequest.isClaimable = false
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.exitQueueIndex = null
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.redeemer = osTokenRedeemer.id
  exitRequest.positionTicket = positionTicket
  exitRequest.timestamp = timestamp
  exitRequest.totalAssets = convertOsTokenSharesToAssets(osToken, shares)
  exitRequest.save()

  return exitRequest
}

export function updateOsTokenRedeemerExitRequests(redeemerAddress: Address): void {
  const osTokenRedeemer = loadOsTokenRedeemer(redeemerAddress)

  if (osTokenRedeemer === null) {
    return
  }

  const redeemerContract = OsTokenRedeemerContract.bind(redeemerAddress)
  const exitRequests = osTokenRedeemer.exitRequests.load()

  for (let i = 0; i < exitRequests.length; i++) {
    const exitRequest = exitRequests[i]

    if (exitRequest.isClaimed) {
      continue
    }

    const indexResult = redeemerContract.try_getExitQueueIndex(exitRequest.positionTicket)

    if (indexResult.reverted || indexResult.value.lt(BigInt.zero())) {
      exitRequest.exitQueueIndex = null
      exitRequest.isClaimable = false
      exitRequest.save()
      continue
    }

    const exitQueueIndex = indexResult.value

    const exitedResult = redeemerContract.try_calculateExitedAssets(
      Address.fromBytes(exitRequest.receiver),
      exitRequest.positionTicket,
      exitQueueIndex,
    )

    if (exitedResult.reverted) {
      continue
    }

    const exitedAssets = exitedResult.value.getExitedAssets()

    exitRequest.isClaimable = exitedAssets.gt(BigInt.zero())
    exitRequest.exitQueueIndex = exitQueueIndex
    exitRequest.exitedAssets = exitedAssets
    exitRequest.save()
  }
}
