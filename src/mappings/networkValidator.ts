import { log } from '@graphprotocol/graph-ts'
import { NetworkValidator, OsTokenExitRequest } from '../../generated/schema'
import { DepositEvent } from '../../generated/ValidatorsRegistry/ValidatorsRegistry'

export function handleDepositEvent(event: DepositEvent): void {
  const publicKey = event.params.pubkey
  let networkValidator = NetworkValidator.load(publicKey)
  if (networkValidator == null) {
    networkValidator = new NetworkValidator(publicKey)
    networkValidator.save()
  }

  log.info('[NetworkValidator] DepositEvent publicKey={}', [publicKey.toHex()])
}
