import { Address, BigInt, Bytes, ipfs, json, JSONValueKind, log, store } from '@graphprotocol/graph-ts'

import { RedeemablePosition, OsTokenRedeemer, OsTokenRedeemerExitRequest } from '../../generated/schema'
import {
  ExitedAssetsClaimed,
  ExitQueueEntered,
  RedeemablePositionsUpdated,
} from '../../generated/OsTokenRedeemer/OsTokenRedeemer'
import { loadVault } from '../entities/vault'
import { createTransaction } from '../entities/transaction'

const osTokenRedeemerId = '1'

export function handleRedeemablePositionsUpdated(event: RedeemablePositionsUpdated): void {
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

  const existing = OsTokenRedeemer.load(osTokenRedeemerId)

  let osTokenRedeemer: OsTokenRedeemer

  if (existing === null) {
    osTokenRedeemer = new OsTokenRedeemer(osTokenRedeemerId)
  } else {
    const previousPositions = existing.positions.load()

    for (let i = 0; i < previousPositions.length; i++) {
      store.remove('RedeemablePosition', previousPositions[i].id)
    }
    osTokenRedeemer = existing
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

    const position = new RedeemablePosition(`${vaultAddress.toHex()}-${owner.toHex()}`)

    position.index = i
    position.owner = owner
    position.vault = vault.id
    position.leafShares = leafShares
    position.redeemableShares = leafShares
    position.osTokenRedeemer = osTokenRedeemerId
    position.ownerAddressString = owner.toHexString()
    position.save()
  }

  log.info('[OsTokenRedeemer] RedeemablePositionsUpdated merkleRoot={} ipfsHash={} count={}', [
    merkleRoot.toHex(),
    ipfsHash,
    items.length.toString(),
  ])
}

export function handleExitQueueEntered(event: ExitQueueEntered): void {
  const owner = event.params.owner
  const shares = event.params.shares
  const receiver = event.params.receiver
  const positionTicket = event.params.positionTicket

  createTransaction(event.transaction.hash.toHex())

  const exitRequest = new OsTokenRedeemerExitRequest(positionTicket.toString())

  exitRequest.owner = owner
  exitRequest.isClaimed = false
  exitRequest.receiver = receiver
  exitRequest.totalShares = shares
  exitRequest.exitedAssets = BigInt.zero()
  exitRequest.positionTicket = positionTicket
  exitRequest.timestamp = event.block.timestamp

  exitRequest.save()

  log.info('[OsTokenRedeemer] ExitQueueEntered owner={} receiver={} positionTicket={} shares={}', [
    owner.toHex(),
    receiver.toHex(),
    positionTicket.toString(),
    shares.toString(),
  ])
}

export function handleExitedAssetsClaimed(event: ExitedAssetsClaimed): void {
  const receiver = event.params.receiver
  const claimedAssets = event.params.withdrawnAssets
  const newPositionTicket = event.params.newPositionTicket
  const prevPositionTicket = event.params.prevPositionTicket

  createTransaction(event.transaction.hash.toHex())

  const prevExitRequest = OsTokenRedeemerExitRequest.load(prevPositionTicket.toString())

  if (prevExitRequest === null) {
    log.error('[OsTokenRedeemer] ExitedAssetsClaimed exit request not found for positionTicket={}', [
      prevPositionTicket.toString(),
    ])
    return
  }

  const isResolved = newPositionTicket.equals(BigInt.zero())
  const claimedTickets = isResolved ? prevExitRequest.totalShares : newPositionTicket.minus(prevPositionTicket)

  if (!isResolved) {
    const nextExitRequest = new OsTokenRedeemerExitRequest(newPositionTicket.toString())

    nextExitRequest.isClaimed = false
    nextExitRequest.receiver = receiver
    nextExitRequest.exitedAssets = BigInt.zero()
    nextExitRequest.owner = prevExitRequest.owner
    nextExitRequest.positionTicket = newPositionTicket
    nextExitRequest.timestamp = prevExitRequest.timestamp
    nextExitRequest.totalShares = prevExitRequest.totalShares.minus(claimedTickets)

    nextExitRequest.save()
  }

  prevExitRequest.exitedAssets = claimedAssets
  prevExitRequest.isClaimed = true
  prevExitRequest.save()

  log.info(
    '[OsTokenRedeemer] ExitedAssetsClaimed receiver={} prevPositionTicket={} newPositionTicket={} claimedAssets={}',
    [receiver.toHex(), prevPositionTicket.toString(), newPositionTicket.toString(), claimedAssets.toString()],
  )
}
