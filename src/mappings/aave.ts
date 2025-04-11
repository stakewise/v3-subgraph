import { Address } from '@graphprotocol/graph-ts'
import { BalanceTransfer } from '../../generated/AaveToken/AaveToken'
import { SupplyCapChanged } from '../../generated/AavePoolConfigurator/AavePoolConfigurator'

import { loadAave } from '../entities/aave'

export function handleSupplyCapChanged(event: SupplyCapChanged): void {
  const aave = loadAave()!
  aave.osTokenSupplyCap = event.params.newSupplyCap
  aave.save()
}

export function handleBalanceTransfer(event: BalanceTransfer): void {
  const from = event.params.from
  const to = event.params.to
  const amount = event.params.value

  if (amount.isZero()) {
    return
  }

  const aave = loadAave()!

  if (from.equals(Address.zero())) {
    aave.osTokenTotalSupplied = aave.osTokenTotalSupplied.plus(amount)
  }
  if (to.equals(Address.zero())) {
    aave.osTokenTotalSupplied = aave.osTokenTotalSupplied.minus(amount)
  }

  aave.save()
}
