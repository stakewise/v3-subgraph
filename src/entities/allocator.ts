import { Address, BigDecimal, BigInt, Bytes, ethereum, log } from '@graphprotocol/graph-ts'
import { Allocator, AllocatorAction, ExitRequest, OsToken, Vault } from '../../generated/schema'
import { Vault as VaultContract } from '../../generated/BlockHandlers/Vault'
import { convertSharesToAssets, getUpdateStateCall } from './vaults'
import { createOrLoadOsToken } from './osToken'

const getExitQueueIndexSelector = '0x60d60e6e'
const calculateExitedAssetsSelector = '0x76b58b90'
const osTokenPositionsSelector = '0x4ec96b22'

export function createOrLoadAllocator(allocatorAddress: Address, vaultAddress: Address): Allocator {
  const vaultAllocatorAddress = `${vaultAddress.toHex()}-${allocatorAddress.toHex()}`

  let vaultAllocator = Allocator.load(vaultAllocatorAddress)

  if (vaultAllocator === null) {
    vaultAllocator = new Allocator(vaultAllocatorAddress)
    vaultAllocator.shares = BigInt.zero()
    vaultAllocator.assets = BigInt.zero()
    vaultAllocator.mintedOsTokenShares = BigInt.zero()
    vaultAllocator.ltv = BigDecimal.zero()
    vaultAllocator.address = allocatorAddress
    vaultAllocator.vault = vaultAddress.toHex()
    vaultAllocator.save()
  }

  return vaultAllocator
}

export function createAllocatorAction(
  event: ethereum.Event,
  vaultAddress: Address,
  actionType: string,
  owner: Address,
  assets: BigInt,
  shares: BigInt | null,
): void {
  if (assets === null && shares === null) {
    log.error('[AllocatorAction] Both assets and shares cannot be null for action={}', [actionType])
    return
  }
  const txHash = event.transaction.hash.toHex()
  const allocatorAction = new AllocatorAction(`${txHash}-${event.transactionLogIndex.toString()}`)
  allocatorAction.vault = vaultAddress.toHex()
  allocatorAction.address = owner
  allocatorAction.actionType = actionType
  allocatorAction.assets = assets
  allocatorAction.shares = shares
  allocatorAction.createdAt = event.block.timestamp
  allocatorAction.save()
}

export function updateAllocatorsMintedOsTokenShares(vault: Vault): void {
  if (!vault.isOsTokenEnabled) {
    return
  }

  const vaultAddress = Address.fromString(vault.id)
  const vaultContract = VaultContract.bind(vaultAddress)
  const allocators = vault.allocators.load()
  const osToken = createOrLoadOsToken()

  let calls: Array<Bytes> = []
  for (let i = 0; i < allocators.length; i++) {
    calls.push(getOsTokenPositionsCall(allocators[i]))
  }

  let allocator: Allocator
  const result = vaultContract.multicall(calls)
  for (let i = 0; i < allocators.length; i++) {
    allocator = allocators[i]
    allocator.mintedOsTokenShares = ethereum.decode('uint256', result[i])!.toBigInt()
    updateAllocatorLtv(allocator, osToken)
    allocator.save()
  }
}

export function updateAllocatorLtv(allocator: Allocator, osToken: OsToken): void {
  // calculate LTV
  if (allocator.assets.notEqual(BigInt.zero()) && osToken.totalSupply.notEqual(BigInt.zero())) {
    const mintedOsTokenAssets = allocator.mintedOsTokenShares.times(osToken.totalAssets).div(osToken.totalSupply)
    allocator.ltv = BigDecimal.fromString(mintedOsTokenAssets.toString()).div(
      BigDecimal.fromString(allocator.assets.toString()),
    )
  } else {
    allocator.ltv = BigDecimal.zero()
  }
}

export function updateExitRequests(vault: Vault): void {
  const vaultAddress = Address.fromString(vault.id)
  const vaultContract = VaultContract.bind(vaultAddress)
  const exitRequests = vault.exitRequests.load()
  let updateStateCall: Bytes | null = null
  if (
    vault.rewardsRoot !== null &&
    vault.proofReward !== null &&
    vault.proofUnlockedMevReward !== null &&
    vault.proof !== null &&
    vault.proof!.length > 0
  ) {
    updateStateCall = getUpdateStateCall(
      vault.rewardsRoot as Bytes,
      vault.proofReward as BigInt,
      vault.proofUnlockedMevReward as BigInt,
      (vault.proof as Array<string>).map<Bytes>((p: string) => Bytes.fromHexString(p)),
    )
  }

  let calls: Array<Bytes> = []
  if (updateStateCall !== null) {
    calls.push(updateStateCall)
  }
  for (let i = 0; i < exitRequests.length; i++) {
    calls.push(getExitQueueIndexCall(exitRequests[i].positionTicket))
  }

  let exitRequestsWithIndex: Array<ExitRequest> = []
  let exitRequest: ExitRequest
  let result = vaultContract.multicall(calls)
  if (updateStateCall !== null) {
    // remove first call result
    result = result.slice(1)
  }

  for (let i = 0; i < result.length; i++) {
    const index = ethereum.decode('int256', result[i])!.toBigInt()
    exitRequest = exitRequests[i]
    if (index.lt(BigInt.zero())) {
      exitRequest.exitQueueIndex = null
      exitRequest.save()
    } else {
      exitRequest.exitQueueIndex = index
      exitRequestsWithIndex.push(exitRequest)
    }
  }

  calls = []
  if (updateStateCall !== null) {
    calls.push(updateStateCall)
  }
  for (let i = 0; i < exitRequestsWithIndex.length; i++) {
    exitRequest = exitRequestsWithIndex[i]
    calls.push(
      getCalculateExitedAssetsCall(
        Address.fromBytes(exitRequest.receiver),
        exitRequest.positionTicket,
        exitRequest.timestamp,
        exitRequest.exitQueueIndex as BigInt,
      ),
    )
  }

  result = vaultContract.multicall(calls)
  if (updateStateCall !== null) {
    // remove first call result
    result = result.slice(1)
  }
  for (let i = 0; i < result.length; i++) {
    exitRequest = exitRequestsWithIndex[i]
    let decodedResult = ethereum.decode('(uint256,uint256,uint256)', result[i])!.toTuple()
    const leftTickets = decodedResult[0].toBigInt()
    const exitedAssets = decodedResult[2].toBigInt()
    if (exitRequest.isV2Position) {
      exitRequest.totalAssets = leftTickets.times(vault.exitingAssets).div(vault.exitingTickets).plus(exitedAssets)
    } else {
      exitRequest.totalAssets = convertSharesToAssets(vault, leftTickets).plus(exitedAssets)
    }
    exitRequest.claimableAssets = exitedAssets
    exitRequest.save()
  }
}

function getOsTokenPositionsCall(allocator: Allocator): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromAddress(Address.fromBytes(allocator.address)))
  return Bytes.fromHexString(osTokenPositionsSelector).concat(encodedArgs as Bytes)
}

function getExitQueueIndexCall(positionTicket: BigInt): Bytes {
  const encodedArgs = ethereum.encode(ethereum.Value.fromUnsignedBigInt(positionTicket))
  return Bytes.fromHexString(getExitQueueIndexSelector).concat(encodedArgs as Bytes)
}

function getCalculateExitedAssetsCall(
  receiver: Address,
  positionTicket: BigInt,
  timestamp: BigInt,
  exitQueueIndex: BigInt,
): Bytes {
  return Bytes.fromHexString(calculateExitedAssetsSelector)
    .concat(ethereum.encode(ethereum.Value.fromAddress(receiver))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(positionTicket))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(timestamp))!)
    .concat(ethereum.encode(ethereum.Value.fromUnsignedBigInt(exitQueueIndex))!)
}
