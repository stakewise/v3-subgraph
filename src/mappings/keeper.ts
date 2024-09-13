import { BigInt, Bytes, ipfs, json, JSONValue, log } from '@graphprotocol/graph-ts'

import { Allocator, Vault } from '../../generated/schema'
import { Harvested, RewardsUpdated, ValidatorsApproval } from '../../generated/Keeper/Keeper'
import { updatePoolApy, updateVaultApy } from '../entities/apySnapshots'
import { WAD } from '../helpers/constants'
import { convertSharesToAssets, createOrLoadVaultsStat, getVaultStateUpdate } from '../entities/vaults'
import { createOrLoadV2Pool, getPoolStateUpdate } from '../entities/v2pool'
import { updateAllocatorLtv } from '../entities/allocator'
import { createOrLoadOsToken } from '../entities/osToken'
import { isGnosisNetwork } from '../entities/network'

export function updateRewards(
  value: JSONValue,
  rewardsRoot: Bytes,
  updateTimestamp: BigInt,
  rewardsIpfsHash: string,
): void {
  const vaultRewards = value.toObject().mustGet('vaults').toArray()
  const vaultsStat = createOrLoadVaultsStat()
  const isGnosis = isGnosisNetwork()
  const v2Pool = createOrLoadV2Pool()
  const osToken = createOrLoadOsToken()
  for (let i = 0; i < vaultRewards.length; i++) {
    // load vault object
    const vaultReward = vaultRewards[i].toObject()
    const vaultId = vaultReward.mustGet('vault').toString().toLowerCase()
    const vault = Vault.load(vaultId)
    if (!vault) {
      log.error('[Keeper] RewardsUpdated vault={} not found', [vaultId])
      continue
    }

    // extract vault reward data
    const lockedMevReward =
      vault.mevEscrow === null ? vaultReward.mustGet('locked_mev_reward').toBigInt() : BigInt.zero()
    const unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const consensusReward = vaultReward.mustGet('consensus_reward').toBigInt()
    const proof = vaultReward
      .mustGet('proof')
      .toArray()
      .map<Bytes>((p: JSONValue): Bytes => Bytes.fromHexString(p.toString()) as Bytes)

    // calculate proof values for state update
    let proofReward: BigInt
    let proofUnlockedMevReward: BigInt
    if (vault.mevEscrow !== null) {
      // vault has own mev escrow, proof reward is consensus reward, nothing can be locked
      proofReward = consensusReward
      proofUnlockedMevReward = BigInt.zero()
    } else if (isGnosis) {
      // for gnosis network, execution rewards are received in DAI and must be converted to GNO
      proofReward = consensusReward
      proofUnlockedMevReward = unlockedMevReward
    } else {
      // vault uses shared mev escrow, proof reward is consensus reward + total mev reward
      proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
      proofUnlockedMevReward = unlockedMevReward
    }

    // fetch new principal, total assets and rate
    let newRate: BigInt, newTotalAssets: BigInt, newTotalShares: BigInt
    if (vault.isGenesis && !v2Pool.migrated) {
      newRate = BigInt.fromString(WAD)
      newTotalAssets = BigInt.zero()
      newTotalShares = BigInt.zero()
    } else {
      const stateUpdate = getVaultStateUpdate(vault, rewardsRoot, proofReward, proofUnlockedMevReward, proof)
      newRate = stateUpdate[0]
      newTotalAssets = stateUpdate[1]
      newTotalShares = stateUpdate[2]
      updateVaultApy(vault, vault.rewardsTimestamp, updateTimestamp, newRate.minus(vault.rate))
    }

    // calculate smoothing pool penalty
    let slashedMevReward = vault.slashedMevReward
    if (vault.lockedExecutionReward.gt(lockedMevReward) && vault.unlockedExecutionReward.ge(unlockedMevReward)) {
      slashedMevReward = slashedMevReward.plus(vault.lockedExecutionReward.minus(lockedMevReward))
    }

    vaultsStat.totalAssets = vaultsStat.totalAssets.minus(vault.totalAssets).plus(newTotalAssets)
    vault.totalAssets = newTotalAssets
    vault.totalShares = newTotalShares
    vault.rate = newRate
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = proofUnlockedMevReward
    vault.consensusReward = consensusReward
    vault.lockedExecutionReward = lockedMevReward
    vault.unlockedExecutionReward = unlockedMevReward
    vault.slashedMevReward = slashedMevReward
    vault.proof = proof.map<string>((proofValue: Bytes) => proofValue.toHexString())
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    vault.canHarvest = true
    vault.save()

    // update v2 pool data
    if (vault.isGenesis && v2Pool.migrated) {
      const stateUpdate = getPoolStateUpdate(rewardsRoot, proofReward, proofUnlockedMevReward, proof)
      const newRate = stateUpdate[0]
      const newRewardAssets = stateUpdate[1]
      const newPrincipalAssets = stateUpdate[2]
      const newPenaltyAssets = stateUpdate[3]
      updatePoolApy(v2Pool, v2Pool.rewardsTimestamp, updateTimestamp, newRate.minus(v2Pool.rate))
      v2Pool.rate = newRate
      v2Pool.principalAssets = newPrincipalAssets
      v2Pool.rewardAssets = newRewardAssets
      v2Pool.penaltyAssets = newPenaltyAssets
      v2Pool.totalAssets = newRewardAssets.plus(newPrincipalAssets).minus(newPenaltyAssets)
      v2Pool.rewardsTimestamp = updateTimestamp
      v2Pool.save()
    }

    // update assets for all the allocators
    let allocator: Allocator
    let allocators = vault.allocators.load()
    for (let j = 0; j < allocators.length; j++) {
      allocator = allocators[j]
      allocator.assets = convertSharesToAssets(vault, allocator.shares)
      updateAllocatorLtv(allocator, osToken)
      allocator.save()
    }
  }
  vaultsStat.save()
}

export function handleRewardsUpdated(event: RewardsUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp

  let data: Bytes | null = ipfs.cat(rewardsIpfsHash)
  while (data === null) {
    log.warning('[Keeper] RewardsUpdated ipfs.cat failed, retrying', [])
    data = ipfs.cat(rewardsIpfsHash)
  }
  updateRewards(json.fromBytes(data as Bytes), rewardsRoot, updateTimestamp, rewardsIpfsHash)
  log.info('[Keeper] RewardsUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
    updateTimestamp.toString(),
  ])
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  const vaultAddress = event.params.vault.toHex()
  const totalAssetsDelta = event.params.totalAssetsDelta

  const vault = Vault.load(vaultAddress)
  if (vault == null) {
    log.error('[Keeper] Harvested vault={} not found', [vaultAddress])
    return
  }
  vault.canHarvest = (vault.rewardsRoot as Bytes).notEqual(event.params.rewardsRoot)
  vault.save()
  if (vault.isGenesis) {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      v2Pool.migrated = true
      v2Pool.save()
    }
  }
  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
}

export function handleValidatorsApproval(event: ValidatorsApproval): void {
  const vaultAddress = event.params.vault.toHex()
  const vault = Vault.load(vaultAddress)

  if (vault === null) {
    log.error('[Keeper] ValidatorsApproval vault={} not found', [vaultAddress])
    return
  }

  vault.isCollateralized = true
  vault.save()

  log.info('[Keeper] ValidatorsApproval vault={}', [vaultAddress])
}
