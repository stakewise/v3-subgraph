import { log } from '@graphprotocol/graph-ts'
import { NetworkValidator } from '../../generated/schema'
import { DepositEvent } from '../../generated/ValidatorsRegistry/ValidatorsRegistry'

export function handleDepositEvent(event: DepositEvent): void {
  const publicKey = event.params.pubkey
  const publicKeyHex = publicKey.toHex()
  const networkValidator = new NetworkValidator(publicKeyHex)

  networkValidator.save()

  log.info('[networkValidatorFactory] networkValidatorCreated publicKey={}', [publicKeyHex])
}
