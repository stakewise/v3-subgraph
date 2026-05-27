import { Address, BigInt, Bytes, ipfs, json, JSONValueKind, log, store } from '@graphprotocol/graph-ts'

import { RedeemablePosition, RedeemablePositions } from '../../generated/schema'
import { RedeemablePositionsUpdated } from '../../generated/OsTokenRedeemer/OsTokenRedeemer'
import { loadVault } from '../entities/vault'

const redeemablePositionsId = '1'

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
    log.error('[OsTokenRedeemer] RedeemablePositionsUpdated ipfs.cat failed for hash={}', [ipfsHash])
    return
  }

  const parsedData = json.fromBytes(data as Bytes)

  if (parsedData.kind != JSONValueKind.ARRAY) {
    log.error('[OsTokenRedeemer] RedeemablePositionsUpdated data is not an array for hash={}', [ipfsHash])
    return
  }

  const existing = RedeemablePositions.load(redeemablePositionsId)

  let redeemablePositions: RedeemablePositions

  if (existing === null) {
    redeemablePositions = new RedeemablePositions(redeemablePositionsId)
  } else {
    const previousPositions = existing.positions.load()

    for (let i = 0; i < previousPositions.length; i++) {
      store.remove('RedeemablePosition', previousPositions[i].id)
    }
    redeemablePositions = existing
  }

  redeemablePositions.merkleRoot = merkleRoot
  redeemablePositions.ipfsHash = ipfsHash
  redeemablePositions.save()

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
    position.redeemablePositions = redeemablePositionsId
    position.save()
  }

  log.info('[OsTokenRedeemer] RedeemablePositionsUpdated merkleRoot={} ipfsHash={} count={}', [
    merkleRoot.toHex(),
    ipfsHash,
    items.length.toString(),
  ])
}
