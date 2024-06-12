import { BigInt, Address, log } from '@graphprotocol/graph-ts'

import {
  StakerDelegated,
  StakerUndelegated,
  StakerForceUndelegated,
} from '../../generated/EigenDelegationManager/EigenDelegationManager'
import { PodSharesUpdated } from '../../generated/EigenPodManager/EigenPodManager'
import {
  EigenPodCreated,
  RestakeOperatorsManagerUpdated,
  RestakeWithdrawalsManagerUpdated,
} from '../../generated/templates/RestakeVault/RestakeVault'
import { EigenPod, Vault } from '../../generated/schema'
import { createTransaction } from '../entities/transaction'

// Handler for the EigenPodCreated event
export function handleEigenPodCreated(event: EigenPodCreated): void {
  const params = event.params
  const pod = params.eigenPod

  const vaultAddress = event.address.toHex()
  const eigenPodId = params.eigenPodOwner.toHex()
  const eigenPod = new EigenPod(eigenPodId)

  eigenPod.address = pod
  eigenPod.operator = Address.zero()
  eigenPod.vault = vaultAddress
  eigenPod.shares = BigInt.zero()
  eigenPod.createdAt = event.block.timestamp
  eigenPod.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[EigenPod] EigenPodCreated vault={} owner={} pod={}', [vaultAddress, eigenPodId, pod.toHex()])
}

// Handler for the RestakeWithdrawalsManagerUpdated event
export function handleRestakeOperatorsManagerUpdated(event: RestakeOperatorsManagerUpdated): void {
  const params = event.params
  const operatorsManager = params.newRestakeOperatorsManager

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.restakeOperatorsManager = operatorsManager
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[RestakeVault] RestakeOperatorsManagerUpdated vault={} operatorsManager={}', [
    vaultAddress,
    operatorsManager.toHex(),
  ])
}

// Handler for the RestakeWithdrawalsManagerUpdated event
export function handleRestakeWithdrawalsManagerUpdated(event: RestakeWithdrawalsManagerUpdated): void {
  const params = event.params
  const withdrawalsManager = params.newRestakeWithdrawalsManager

  const vaultAddress = event.address.toHex()
  const vault = Vault.load(vaultAddress) as Vault

  vault.restakeWithdrawalsManager = withdrawalsManager
  vault.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[RestakeVault] RestakeWithdrawalsManagerUpdated vault={} withdrawalsManager={}', [
    vaultAddress,
    withdrawalsManager.toHex(),
  ])
}

// Handler for the EigenDelegationManager.StakerDelegated event
export function handleStakerDelegated(event: StakerDelegated): void {
  const params = event.params

  const eigenPodId = params.staker.toHex()
  const eigenPod = EigenPod.load(eigenPodId)
  if (eigenPod == null) {
    log.debug('[EigenDelegationManager] EigenPod not found owner={}', [eigenPodId])
    return
  }

  eigenPod.operator = params.operator
  eigenPod.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[EigenDelegationManager] StakerDelegated staker={} operator={}', [eigenPodId, params.operator.toHex()])
}

// Handler for the EigenDelegationManager.StakerUndelegated event
export function handleStakerUndelegated(event: StakerUndelegated): void {
  const params = event.params

  const eigenPodId = params.staker.toHex()
  const eigenPod = EigenPod.load(eigenPodId)
  if (eigenPod == null) {
    log.debug('[EigenDelegationManager] EigenPod not found owner={}', [eigenPodId])
    return
  }

  eigenPod.operator = null
  eigenPod.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[EigenDelegationManager] StakerUndelegated staker={}', [eigenPodId])
}

// Handler for the EigenDelegationManager.StakerForceUndelegated event
export function handleStakerForceUndelegated(event: StakerForceUndelegated): void {
  const params = event.params

  const eigenPodId = params.staker.toHex()
  const eigenPod = EigenPod.load(eigenPodId)
  if (eigenPod == null) {
    log.debug('[EigenDelegationManager] EigenPod not found owner={}', [eigenPodId])
    return
  }

  eigenPod.operator = null
  eigenPod.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[EigenDelegationManager] StakerForceUndelegated staker={}', [eigenPodId])
}

// Handler for the EigenPodManager.PodSharesUpdated event
export function handlePodSharesUpdated(event: PodSharesUpdated): void {
  const params = event.params

  const eigenPodId = params.podOwner.toHex()
  const eigenPod = EigenPod.load(eigenPodId)
  if (eigenPod == null) {
    log.debug('[EigenPodManager] EigenPod not found owner={}', [eigenPodId])
    return
  }

  eigenPod.shares = eigenPod.shares.plus(params.sharesDelta)
  eigenPod.save()

  createTransaction(event.transaction.hash.toHex())

  log.info('[EigenPodManager] PodSharesUpdated owner={} shares={}', [eigenPodId, params.sharesDelta.toString()])
}
