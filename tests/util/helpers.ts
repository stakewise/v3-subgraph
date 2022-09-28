import { handleVaultCreated } from '../../src/mappings/vaultFactory'

import { createVaultEvent } from './events'
import { address } from './mock'


const createVault = (
  maxTotalAssets: string = '10000',
  feePercent: string = '10',
): void => {
  const vaultEvent = createVaultEvent(
    address.get('caller'),
    address.get('vault'),
    address.get('feesEscrow'),
    address.get('operator'),
    maxTotalAssets,
    feePercent,
  )

  handleVaultCreated(vaultEvent)
}


export {
  createVault,
}
