import { Address, BigDecimal, BigInt, Bytes, store } from '@graphprotocol/graph-ts'
import { Network, RewardSplitter, User, Vault } from '../../generated/schema'
import { NETWORK, V2_REWARD_TOKEN, V2_STAKED_TOKEN } from '../helpers/constants'

const networkId = '0'
export function loadNetwork(): Network | null {
  return Network.load(networkId)
}

export function createOrLoadNetwork(): Network {
  let network = loadNetwork()

  if (network === null) {
    network = new Network(networkId)
    network.factoriesInitialized = false
    network.vaultsCount = 0
    network.usersCount = 0
    network.totalAssets = BigInt.zero()
    network.totalEarnedAssets = BigInt.zero()
    network.vaultIds = []
    network.osTokenVaultIds = []
    network.oraclesConfigIpfsHash = ''
    network.assetsUsdRate = BigDecimal.zero()
    network.swiseUsdRate = BigDecimal.zero()
    network.daiUsdRate = BigDecimal.zero()
    network.usdcUsdRate = BigDecimal.zero()
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
    const network = loadNetwork()!
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
    RewardSplitter.load(userAddress.toHex()) !== null ||
    userAddress.equals(V2_REWARD_TOKEN) ||
    userAddress.equals(V2_STAKED_TOKEN) ||
    userAddress.equals(Address.zero())
  ) {
    return
  }
  const user = createOrLoadUser(userAddress)
  if (!user.isOsTokenHolder && user.vaultsCount === 0) {
    const network = loadNetwork()!
    network.usersCount = network.usersCount + 1
    network.save()
  }
  user.vaultsCount = user.vaultsCount + 1
  user.save()
}
