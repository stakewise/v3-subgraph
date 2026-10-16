import { Address, BigInt } from '@graphprotocol/graph-ts'

import { OsTokenRedeemer } from '../../generated/schema'
import { OsTokenRedeemer as OsTokenRedeemerContract } from '../../generated/OsTokenRedeemer/OsTokenRedeemer'

export const osTokenRedeemerId = '1'

export function updateOsTokenRedeemerExitRequests(redeemerAddress: Address): void {
  const osTokenRedeemer = OsTokenRedeemer.load(osTokenRedeemerId)

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
