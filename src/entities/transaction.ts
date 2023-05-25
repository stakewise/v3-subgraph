import { ethereum } from '@graphprotocol/graph-ts'
import { Transaction } from '../../generated/schema'


export function createTransaction(event: ethereum.Event): Transaction {
  const hash = event.transaction.hash.toHex()
  const logIndex = event.transactionLogIndex

  let transaction = Transaction.load(hash)

  if (transaction === null) {
    transaction = new Transaction(`${hash}-${logIndex.toString()}`)
    transaction.hash = hash
    transaction.save()
  }

  return transaction
}
