import { log } from '@graphprotocol/graph-ts'
import { VestingEscrowCreated } from '../../generated/templates/VestingEscrowFactory/VestingEscrowFactory'
import { VestingEscrow } from '../../generated/schema'

export function createVestingEscrow(event: VestingEscrowCreated): void {
  const vestingEscrowAddress = event.params.escrow
  const vestingEscrowAddressHex = vestingEscrowAddress.toHex()
  const token = event.params.token.toHex()
  const recipient = event.params.recipient.toHex()

  const vestingEscrow = new VestingEscrow(vestingEscrowAddressHex)

  vestingEscrow.token = token
  vestingEscrow.recipient = recipient
  vestingEscrow.save()

  log.info(
    '[VestingEscrowFactory] VestingEscrowCreated address={} token={} recipient={}',
    [
      vestingEscrowAddressHex,
      token,
      recipient,
    ],
  )
}
