import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'
import { OwnMevEscrow, Vault } from '../../generated/schema'

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

export function syncEthOwnMevEscrow(vault: Vault): BigInt {
  // has own mev escrow
  const mevEscrow = Address.fromBytes(vault.mevEscrow!)
  const ownMevEscrow = createOrLoadOwnMevEscrow(mevEscrow)
  const newCheckpointAssets = ownMevEscrow.totalHarvestedAssets.plus(ethereum.getBalance(mevEscrow))

  const periodAssets = newCheckpointAssets.minus(ownMevEscrow.lastCheckpointAssets)
  ownMevEscrow.lastCheckpointAssets = newCheckpointAssets
  ownMevEscrow.save()

  return periodAssets
}
