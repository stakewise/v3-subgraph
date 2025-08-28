import { BigInt, Bytes } from '@graphprotocol/graph-ts'
import { Checkpoint } from '../../generated/schema'

export enum CheckpointType {
  VAULTS,
  KEEPER,
  OS_TOKEN,
  DISTRIBUTOR,
  LEVERAGE_STRATEGY,
  APYS,
  SNAPSHOTS,
}

const CheckpointTypeStrings: Array<string> = [
  'VAULTS',
  'KEEPER',
  'OS_TOKEN',
  'DISTRIBUTOR',
  'LEVERAGE_STRATEGY',
  'APYS',
  'SNAPSHOTS',
]

export function createOrLoadCheckpoint(checkpointType: CheckpointType): Checkpoint {
  const checkpointId = Bytes.fromUTF8(CheckpointTypeStrings[checkpointType])
  let checkpoint = Checkpoint.load(checkpointId)

  if (checkpoint === null) {
    checkpoint = new Checkpoint(checkpointId)
    checkpoint.timestamp = BigInt.zero()
    checkpoint.save()
  }

  return checkpoint
}
