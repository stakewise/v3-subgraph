import { Address, BigDecimal } from '@graphprotocol/graph-ts'
import { BalancerPoolToken } from '../../generated/schema'

export function createOrLoadBalancerPoolToken(tokenAddress: string): BalancerPoolToken {
  const tokenId = Address.fromString(tokenAddress)

  let poolToken = BalancerPoolToken.load(tokenId)

  if (poolToken === null) {
    poolToken = new BalancerPoolToken(tokenId)
    poolToken.balance = BigDecimal.zero()
    poolToken.save()
  }

  return poolToken
}
