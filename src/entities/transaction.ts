import { BigInt } from '@graphprotocol/graph-ts'

import { Transaction } from '../../generated/schema'


export function createTransaction(transactionHash: string): Transaction {
  let transaction = Transaction.load(transactionHash)

  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.hash = transactionHash
    transaction.logIndex = BigInt.fromI32(0)
    transaction.save()
  }

  return transaction
}
