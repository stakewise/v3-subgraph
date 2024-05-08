import { VestingEscrowCreated } from '../../generated/templates/VestingEscrowFactory/VestingEscrowFactory'
import { createVestingEscrow } from '../entities/vestingEscrow'

export function handleVestingEscrowCreated(event: VestingEscrowCreated): void {
  createVestingEscrow(event)
}
