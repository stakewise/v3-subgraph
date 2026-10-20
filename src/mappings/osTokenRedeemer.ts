import { Address, BigInt, Bytes, ipfs, json, JSONValueKind, log, store } from '@graphprotocol/graph-ts'

import { OsTokenRedeemerExitRequest, RedeemablePosition } from '../../generated/schema'
import { ExitQueueEntered as ExitQueueEnteredV1 } from '../../generated/OsTokenRedeemerV1/OsTokenRedeemerV1'
import {
  ExitQueueEntered,
  CheckpointCreated,
  ExitedAssetsClaimed,
  RedeemablePositionsUpdated,
} from '../../generated/OsTokenRedeemerV1/OsTokenRedeemer'
import { loadVault } from '../entities/vault'
import { createTransaction } from '../entities/transaction'
import { convertOsTokenSharesToAssets, loadOsToken } from '../entities/osToken'
import {
  createOrLoadOsTokenRedeemer,
  createOsTokenRedeemerExitRequest,
  getOsTokenRedeemerExitRequestId,
  getRedeemablePositionId,
  updateOsTokenRedeemerExitRequests,
} from '../entities/osTokenRedeemer'

export function handleRedeemablePositionsUpdated(event: RedeemablePositionsUpdated): void {
  const redeemerAddress = event.address
  const merkleRoot = event.params.merkleRoot
  const ipfsHash = event.params.ipfsHash

  let data: Bytes | null = ipfs.cat(ipfsHash)
  let tries = 5

  while (data === null && tries > 0) {
    log.warning('[OsTokenRedeemer] RedeemablePositionsUpdated ipfs.cat failed for hash={}, retrying', [ipfsHash])
    data = ipfs.cat(ipfsHash)
    tries -= 1
  }

  if (data === null) {
    assert(false, `[OsTokenRedeemer] RedeemablePositionsUpdated ipfs.cat failed for hash=${ipfsHash}`)
  }

  const parsedData = json.fromBytes(data as Bytes)

  if (parsedData.kind != JSONValueKind.ARRAY) {
    log.error('[OsTokenRedeemer] RedeemablePositionsUpdated data is not an array for hash={}', [ipfsHash])
    return
  }

  const osTokenRedeemer = createOrLoadOsTokenRedeemer(redeemerAddress)
  const previousPositions = osTokenRedeemer.positions.load()

  for (let i = 0; i < previousPositions.length; i++) {
    store.remove('RedeemablePosition', previousPositions[i].id)
  }

  osTokenRedeemer.merkleRoot = merkleRoot
  osTokenRedeemer.ipfsHash = ipfsHash
  osTokenRedeemer.save()

  const items = parsedData.toArray()

  for (let i = 0; i < items.length; i++) {
    const _item = items[i]

    if (_item.kind != JSONValueKind.OBJECT) {
      log.error('[OsTokenRedeemer] RedeemablePositionsUpdated item is not an object for hash={} index={}', [
        ipfsHash,
        i.toString(),
      ])
      continue
    }

    const item = _item.toObject()
    const _owner = item.get('owner')
    const _vault = item.get('vault')
    const _leafShares = item.get('leaf_shares')

    if (!_owner || _owner.kind != JSONValueKind.STRING) {
      log.error('[OsTokenRedeemer] RedeemablePositionsUpdated owner is invalid for hash={} index={}', [
        ipfsHash,
        i.toString(),
      ])
      continue
    }
    if (!_vault || _vault.kind != JSONValueKind.STRING) {
      log.error('[OsTokenRedeemer] RedeemablePositionsUpdated vault is invalid for hash={} index={}', [
        ipfsHash,
        i.toString(),
      ])
      continue
    }
    if (!_leafShares || _leafShares.kind != JSONValueKind.STRING) {
      log.error('[OsTokenRedeemer] RedeemablePositionsUpdated leaf_shares is invalid for hash={} index={}', [
        ipfsHash,
        i.toString(),
      ])
      continue
    }

    const owner = Address.fromString(_owner.toString())
    const vaultAddress = Address.fromString(_vault.toString())
    const leafShares = BigInt.fromString(_leafShares.toString())

    const vault = loadVault(vaultAddress)

    if (vault === null) {
      log.error('[OsTokenRedeemer] RedeemablePositionsUpdated vault not found for hash={} index={} vault={}', [
        ipfsHash,
        i.toString(),
        vaultAddress.toHex(),
      ])
      continue
    }

    const position = new RedeemablePosition(getRedeemablePositionId(redeemerAddress, vaultAddress, owner))

    position.index = i
    position.owner = owner
    position.vault = vault.id
    position.leafShares = leafShares
    position.redeemableShares = leafShares
    position.osTokenRedeemer = osTokenRedeemer.id
    position.ownerAddressString = owner.toHexString()
    position.save()
  }

  log.info('[OsTokenRedeemer] RedeemablePositionsUpdated redeemer={} merkleRoot={} ipfsHash={} count={}', [
    redeemerAddress.toHex(),
    merkleRoot.toHex(),
    ipfsHash,
    items.length.toString(),
  ])
}

// V1 redeemer: event has no fee parameter
export function handleExitQueueEnteredV1(event: ExitQueueEnteredV1): void {
  createTransaction(event.transaction.hash.toHex())
  createOsTokenRedeemerExitRequest(
    event.address,
    event.params.owner,
    event.params.receiver,
    event.params.positionTicket,
    event.params.shares,
    event.block.timestamp,
  )

  log.info('[OsTokenRedeemer] ExitQueueEntered redeemer={} owner={} receiver={} positionTicket={} shares={}', [
    event.address.toHex(),
    event.params.owner.toHex(),
    event.params.receiver.toHex(),
    event.params.positionTicket.toString(),
    event.params.shares.toString(),
  ])
}

// shares are already net of the redemption fee
export function handleExitQueueEntered(event: ExitQueueEntered): void {
  createTransaction(event.transaction.hash.toHex())
  createOsTokenRedeemerExitRequest(
    event.address,
    event.params.owner,
    event.params.receiver,
    event.params.positionTicket,
    event.params.shares,
    event.block.timestamp,
  )

  log.info('[OsTokenRedeemer] ExitQueueEntered redeemer={} owner={} receiver={} positionTicket={} shares={} fee={}', [
    event.address.toHex(),
    event.params.owner.toHex(),
    event.params.receiver.toHex(),
    event.params.positionTicket.toString(),
    event.params.shares.toString(),
    event.params.fee.toString(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const redeemerAddress = event.address
  const receiver = event.params.receiver
  const claimedAssets = event.params.withdrawnAssets
  const newPositionTicket = event.params.newPositionTicket
  const prevPositionTicket = event.params.prevPositionTicket

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequest = OsTokenRedeemerExitRequest.load(
    getOsTokenRedeemerExitRequestId(redeemerAddress, prevPositionTicket),
  )

  if (prevExitRequest === null) {
    log.error('[OsTokenRedeemer] ExitedAssetsClaimed exit request not found for redeemer={} positionTicket={}', [
      redeemerAddress.toHex(),
      prevPositionTicket.toString(),
    ])
    return
  }

  const isResolved = newPositionTicket.equals(BigInt.zero())
  const claimedTickets = isResolved ? prevExitRequest.totalShares : newPositionTicket.minus(prevPositionTicket)

  if (!isResolved) {
    const osToken = loadOsToken()!
    const nextExitRequest = new OsTokenRedeemerExitRequest(
      getOsTokenRedeemerExitRequestId(redeemerAddress, newPositionTicket),
    )

    nextExitRequest.isClaimed = false
    nextExitRequest.isClaimable = false
    nextExitRequest.receiver = receiver
    nextExitRequest.exitQueueIndex = null
    nextExitRequest.exitedAssets = BigInt.zero()
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.positionTicket = newPositionTicket
    nextExitRequest.redeemer = prevExitRequest.redeemer
    nextExitRequest.timestamp = prevExitRequest.timestamp
    nextExitRequest.totalShares = prevExitRequest.totalShares.minus(claimedTickets)
    nextExitRequest.totalAssets = convertOsTokenSharesToAssets(osToken, nextExitRequest.totalShares)

    nextExitRequest.save()
  }

  prevExitRequest.exitedAssets = claimedAssets
  prevExitRequest.isClaimable = false
  prevExitRequest.isClaimed = true
  prevExitRequest.save()

  log.info(
    '[OsTokenRedeemer] ExitedAssetsClaimed redeemer={} receiver={} prevPositionTicket={} newPositionTicket={} claimedAssets={}',
    [
      redeemerAddress.toHex(),
      receiver.toHex(),
      prevPositionTicket.toString(),
      newPositionTicket.toString(),
      claimedAssets.toString(),
    ],
  )
}

export function handleCheckpointCreated(event: CheckpointCreated): void {
  updateOsTokenRedeemerExitRequests(event.address)

  log.info('[OsTokenRedeemer] CheckpointCreated redeemer={} shares={} assets={}', [
    event.address.toHex(),
    event.params.shares.toString(),
    event.params.assets.toString(),
  ])
}
