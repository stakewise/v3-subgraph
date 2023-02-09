import { BigInt } from '@graphprotocol/graph-ts'

import { Transaction } from '../../generated/schema'


export function createTransaction(transactionHash: string, logIndex: BigInt): Transaction {
  let transaction = Transaction.load(transactionHash)

  if (transaction === null) {
    transaction = new Transaction(`${transactionHash}-${logIndex.toString()}`)
    transaction.hash = transactionHash
    transaction.logIndex = logIndex
    transaction.save()
  }

  return transaction
}
