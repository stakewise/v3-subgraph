import { Address, BigInt } from '@graphprotocol/graph-ts'
import { BalanceTransfer, Burn, Mint } from '../../generated/AaveToken/AaveToken'
import { SupplyCapChanged } from '../../generated/AavePoolConfigurator/AavePoolConfigurator'
import { loadAave } from '../entities/aave'
import { OS_TOKEN, WAD } from '../helpers/constants'
import { rayMul } from '../helpers/utils'

function mint(value: BigInt, balanceIncrease: BigInt, onBehalf: Address): void {
  const onBehalfString = onBehalf.toHexString().toLowerCase()

  const isMintingToTreasury =
    onBehalfString != '0xb2289e329d2f85f1ed31adbb30ea345278f21bcf' &&
    onBehalfString != '0xe8599f3cc5d38a9ad6f3684cd5cea72f10dbc383' &&
    onBehalfString != '0xbe85413851d195fc6341619cd68bfdc26a25b928' &&
    onBehalfString != '0x5ba7fd868c40c16f7adfae6cf87121e13fc2f7a0' &&
    onBehalfString != '0x8a020d92d6b119978582be4d3edfdc9f7b28bf31' &&
    onBehalfString != '0x053d55f9b5af8694c503eb288a1b7e552f590710' &&
    onBehalfString != '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c'

  if (isMintingToTreasury) {
    const aave = loadAave()!
    const userBalanceChange = value.minus(balanceIncrease)

    aave.osTokenTotalSupplied = aave.osTokenTotalSupplied.plus(userBalanceChange)
    aave.save()
  }
}

function burn(value: BigInt, balanceIncrease: BigInt): void {
  const aave = loadAave()!
  const userBalanceChange = value.plus(balanceIncrease)

  aave.osTokenTotalSupplied = aave.osTokenTotalSupplied.minus(userBalanceChange)
  aave.save()
}

export function handleMint(event: Mint): void {
  mint(event.params.value, event.params.balanceIncrease, event.params.onBehalfOf)
}

export function handleBurn(event: Burn): void {
  burn(event.params.value, event.params.balanceIncrease)
}

export function handleTransfer(event: BalanceTransfer): void {
  let balanceTransferValue = event.params.value

  if (event.block.number.toU32() > 0) {
    balanceTransferValue = rayMul(balanceTransferValue, event.params.index)
  }

  burn(balanceTransferValue, BigInt.zero())
  mint(balanceTransferValue, BigInt.zero(), event.params.to)
}

export function handleSupplyCapChanged(event: SupplyCapChanged): void {
  if (event.params.asset.equals(OS_TOKEN)) {
    const aave = loadAave()!

    aave.osTokenSupplyCap = event.params.newSupplyCap.times(BigInt.fromString(WAD))
    aave.save()
  }
}
