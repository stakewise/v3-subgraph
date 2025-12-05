import { Address, BigInt } from '@graphprotocol/graph-ts'
import { Vault, XdaiConverter } from '../../generated/schema'
import { Erc20Token } from '../../generated/Keeper/Erc20Token'
import { ASSET_TOKEN } from '../helpers/constants'

export function loadXdaiConverter(vaultAddress: Address): XdaiConverter | null {
  return XdaiConverter.load(vaultAddress.toHexString())
}

export function createXdaiConverter(vaultAddress: Address, converterAddress: Address): XdaiConverter {
  const id = vaultAddress.toHexString()
  const converter = new XdaiConverter(id)
  converter.address = converterAddress
  converter.totalHarvestedAssets = BigInt.zero()
  converter.lastCheckpointAssets = BigInt.zero()
  converter.save()

  return converter
}

export function syncXdaiConverter(vault: Vault): BigInt {
  const converter = loadXdaiConverter(Address.fromString(vault.id))
  if (converter === null) {
    return BigInt.zero()
  }
  const converterAddress = converter.address
  const assetToken = Erc20Token.bind(Address.fromString(ASSET_TOKEN))
  const assetBalance = assetToken.balanceOf(Address.fromBytes(converterAddress))
  const newCheckpointAssets = converter.totalHarvestedAssets.plus(assetBalance)

  const periodAssets = newCheckpointAssets.minus(converter.lastCheckpointAssets)
  converter.lastCheckpointAssets = newCheckpointAssets
  converter.save()

  return periodAssets
}
