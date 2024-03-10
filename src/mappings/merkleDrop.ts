import { Address, BigInt, Bytes, dataSource, ethereum, ipfs, json, JSONValue, log } from '@graphprotocol/graph-ts'
import { MerkleDropAllocation } from '../../generated/schema'
import { Claimed } from '../../generated/StarknetMerkleDrop/MerkleDrop'
import { createTransaction } from '../entities/transaction'
import { ZERO_ADDRESS } from '../helpers/constants'

export function initialize(block: ethereum.Block): void {
  const context = dataSource.context()
  const merkleDropAddress = context.getString('merkleDropAddress').toLowerCase()
  log.info('[MerkleDrop] Initialize merkle drop with address={}', [merkleDropAddress])
  if (merkleDropAddress == ZERO_ADDRESS) {
    return
  }

  const ipfsHash = context.getString('merkleDropIpfsHash')
  const data = ipfs.cat(ipfsHash) as Bytes

  // save allocations to the subgraph
  const allocations = json.fromBytes(data).toObject().mustGet('claims').toArray()
  for (let i = 0; i < allocations.length; i++) {
    const allocation = allocations[i].toObject()
    const account = allocation.mustGet('account').toString().toLowerCase()
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

  createTransaction(event.transaction.hash.toHex())
  log.info('[MerkleDrop] Claimed account={} amount={}', [
    event.params.account.toHexString(),
    allocation.amount.toString(),
  ])
}
