import { handleVaultCreated } from '../../src/mappings/vaultFactory'

import { createVaultEvent } from './events'
import { address } from './mock'


const createVault = (
  name: string = 'name',
  symbol: string = 'symbol',
  capacity: string = '10000',
  feePercent: string = '10',
): void => {
  const vaultEvent = createVaultEvent(
    address.get('factory'),
    address.get('admin'),
    address.get('vault'),
    address.get('mevEscrow'),
    name,
    symbol,
    capacity,
    feePercent,
  )

  handleVaultCreated(vaultEvent)
}


export {
  createVault,
}
