import { Network } from '../../generated/schema'
import { PriceFeed } from '../../generated/Keeper/PriceFeed'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { DAI_USD_PRICE_FEED, GNO_USD_PRICE_FEED, WAD, ZERO_ADDRESS } from '../helpers/constants'

export function createOrLoadNetwork(): Network {
  const id = '0'

  let network = Network.load(id)

  if (network === null) {
    network = new Network(id)
    network.vaultsTotal = 0
    network.save()
  }

  return network
}

export function getConversionRate(): BigInt {
  if (GNO_USD_PRICE_FEED == ZERO_ADDRESS) {
    return BigInt.fromString(WAD)
  }

  const daiUsdRate = PriceFeed.bind(Address.fromString(DAI_USD_PRICE_FEED)).latestAnswer()
  const gnoUsdRate = PriceFeed.bind(Address.fromString(GNO_USD_PRICE_FEED)).latestAnswer()
  return daiUsdRate.times(BigInt.fromString(WAD)).div(gnoUsdRate)
}
