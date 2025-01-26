import {Bytes, ethereum, ipfs, json, log} from '@graphprotocol/graph-ts'
import { NetworkValidator, OsTokenExitRequest } from '../../generated/schema'
import { DepositEvent } from '../../generated/ValidatorsRegistry/ValidatorsRegistry'
import { GENESIS_IPFS_HASH } from '../helpers/constants'

export function handleDepositEvent(event: DepositEvent): void {
  const publicKey = event.params.pubkey
  let networkValidator = NetworkValidator.load(publicKey)
  if (networkValidator == null) {
    networkValidator = new NetworkValidator(publicKey)
    networkValidator.save()
  }

  log.info('[NetworkValidator] DepositEvent publicKey={}', [publicKey.toHex()])
}

export function handleGenesisValidators(block: ethereum.Block): void {
  log.info('[NetworkValidator] start genesis validators processing...', [])

  if (!GENESIS_IPFS_HASH){
    log.info('[NetworkValidator] empty ipfs hash', [])
    return
  }
  let data: Bytes | null = ipfs.cat(GENESIS_IPFS_HASH)
  while (!data) {
    log.warning('[NetworkValidator] genesis hash ipfs.cat failed for hash={} retrying', [GENESIS_IPFS_HASH])
    data = ipfs.cat(GENESIS_IPFS_HASH)
  }

  for (let i = 0; i < data!.length; i=i+48) {
    let publicKey =  Bytes.fromUint8Array(data!.slice(i, i + 48))
    let networkValidator = NetworkValidator.load(publicKey)
    if (networkValidator == null) {
      networkValidator = new NetworkValidator(publicKey)
      networkValidator.save()
    }
    log.info('[NetworkValidator] DepositEvent publicKey={}', [publicKey.toHex()])
  }
  log.info('[NetworkValidator] successfully processed genesis validators for hash {}', [
    GENESIS_IPFS_HASH
  ])
}