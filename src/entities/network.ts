import { Address, BigDecimal, BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { Network, User, Vault } from '../../generated/schema'
import { NETWORK, V2_REWARD_TOKEN, V2_STAKED_TOKEN } from '../helpers/constants'

export function createOrLoadNetwork(): Network {
  const id = '0'

  let network = Network.load(id)

  if (network === null) {
    network = new Network(id)
    network.vaultsCount = 0
    network.usersCount = 0
    network.totalAssets = BigInt.zero()
    network.totalEarnedAssets = BigInt.zero()
    network.vaultIds = []
    network.osTokenVaultIds = []
    network.assetsUsdRate = BigDecimal.zero()
    network.usdToDaiRate = BigDecimal.zero()
    network.usdToEurRate = BigDecimal.zero()
    network.usdToGbpRate = BigDecimal.zero()
    network.save()
  }

  return network
}

export function isGnosisNetwork(): boolean {
  return NETWORK == 'chiado' || NETWORK == 'gnosis'
}

export function createOrLoadUser(userAddress: Bytes): User {
  const id = userAddress.toHexString()

  let user = User.load(id)
  if (user === null) {
    user = new User(id)
    user.vaultsCount = 0
    user.isOsTokenHolder = false
    user.save()
  }

  return user
}

export function decreaseUserVaultsCount(userAddress: Bytes): void {
  if (
    Vault.load(userAddress.toHex()) !== null ||
    userAddress.equals(V2_REWARD_TOKEN) ||
    userAddress.equals(V2_STAKED_TOKEN) ||
    userAddress.equals(Address.zero())
  ) {
    return
  }
  const user = createOrLoadUser(userAddress)
  if (!user.isOsTokenHolder && user.vaultsCount === 1) {
    const network = createOrLoadNetwork()
    network.usersCount = network.usersCount - 1
    network.save()
    store.remove('User', user.id)
  } else {
    user.vaultsCount = user.vaultsCount - 1
    user.save()
  }
}

export function increaseUserVaultsCount(userAddress: Bytes): void {
  if (
    Vault.load(userAddress.toHex()) !== null ||
    userAddress.equals(V2_REWARD_TOKEN) ||
    userAddress.equals(V2_STAKED_TOKEN) ||
    userAddress.equals(Address.zero())
  ) {
    return
  }
  const user = createOrLoadUser(userAddress)
  if (!user.isOsTokenHolder && user.vaultsCount === 0) {
    const network = createOrLoadNetwork()
    network.usersCount = network.usersCount + 1
    network.save()
  }
  user.vaultsCount = user.vaultsCount + 1
  user.save()
}
