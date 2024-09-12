import { Network } from '../../generated/schema'

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
