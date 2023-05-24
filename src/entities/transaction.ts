import { Transaction } from '../../generated/schema'


export function createTransaction(transactionHash: string): Transaction {
  let transaction = Transaction.load(transactionHash)
  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.save()
  }
  return transaction
}
