import { Address, BigInt, Bytes, dataSource, ethereum, ipfs, json, JSONValue, log } from '@graphprotocol/graph-ts'
import { MerkleDropAllocation } from '../../generated/schema'
import { Claimed } from '../../generated/StarknetMerkleDrop/MerkleDrop'

export function initialize(block: ethereum.Block): void {
  const context = dataSource.context()
  const ipfsHash = context.getString('merkleDropIpfsHash')
  const merkleDropAddress = context.getString('merkleDropAddress')
  const data = ipfs.cat(ipfsHash) as Bytes

  // save allocations to the subgraph
  const allocations = json.fromBytes(data).toObject().mustGet('claims').toArray()
  for (let i = 0; i < allocations.length; i++) {
    const allocation = allocations[i].toObject()
    const account = allocation.mustGet('account').toString()
    const allocationId = `${merkleDropAddress}-${account}`
    const merkleDropAllocation = new MerkleDropAllocation(allocationId)
    const proof = allocation.mustGet('proof').toArray()
    merkleDropAllocation.index = allocation.mustGet('index').toBigInt()
    merkleDropAllocation.account = Address.fromString(account)
    merkleDropAllocation.amount = BigInt.fromString(allocation.mustGet('amount').toString())
    merkleDropAllocation.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    merkleDropAllocation.isClaimed = false
    merkleDropAllocation.save()
  }
  log.info('[MerkleDrop] Initialize merkle drop at block={}', [block.number.toString()])
}

export function handleClaimed(event: Claimed): void {
  const allocationId = `${event.address.toHex()}-${event.params.account.toHex()}`
  let allocation = MerkleDropAllocation.load(allocationId) as MerkleDropAllocation
  allocation.isClaimed = true
  allocation.save()
  log.info('[MerkleDrop] Claimed account={} amount={}', [
    event.params.account.toHexString(),
    allocation.amount.toString(),
  ])
}
