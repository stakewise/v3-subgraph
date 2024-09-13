import { Network } from '../../generated/schema'
import { NETWORK } from '../helpers/constants'

export function createOrLoadNetwork(): Network {
  const id = '0'

  let network = Network.load(id)

  if (network === null) {
    network = new Network(id)
    network.vaultsTotal = 0
    network.vaultIds = []
    network.save()
  }

  return network
}

export function isGnosisNetwork(): boolean {
  return NETWORK == 'chiado' || NETWORK == 'gnosis'
}
