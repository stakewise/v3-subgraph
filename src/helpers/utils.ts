import { Address, Bytes, ethereum } from '@graphprotocol/graph-ts'

export function getAggregateCall(target: Address, data: Bytes): ethereum.Value {
  const struct: Array<ethereum.Value> = [ethereum.Value.fromAddress(target), ethereum.Value.fromBytes(data)]
  return ethereum.Value.fromTuple(changetype<ethereum.Tuple>(struct))
}
