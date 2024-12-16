import { Address, BigInt } from '@graphprotocol/graph-ts'
import { OwnMevEscrow } from '../../generated/schema'

export function createOrLoadOwnMevEscrow(escrowAddress: Address): OwnMevEscrow {
  const id = escrowAddress.toHexString()
  let escrow = OwnMevEscrow.load(id)
  if (escrow === null) {
    escrow = new OwnMevEscrow(id)
    escrow.totalHarvestedAssets = BigInt.zero()
    escrow.lastCheckpointAssets = BigInt.zero()
    escrow.save()
  }
  return escrow
}
