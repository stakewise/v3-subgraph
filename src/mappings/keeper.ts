import { BigInt, ipfs, JSONValue, log, Value } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested, RewardsUpdated } from '../../generated/Keeper/Keeper'
import { updateVaultApy } from '../entities/apySnapshots'
import { createOrLoadV2Pool } from '../entities/v2pool'
import { IGNORED_APY_CALC_OWN_MEV_IPFS_HASH } from '../helpers/constants'

export function updateRewards(value: JSONValue, callbackDataValue: Value): void {
  const callbackData = callbackDataValue.toArray()
  const rewardsRoot = callbackData[0].toBytes()
  const updateTimestamp = callbackData[1].toBigInt()
  const rewardsIpfsHash = callbackData[2].toString()
  const vaultRewards = value.toObject().mustGet('vaults').toArray()
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
    const lockedMevReward = vaultReward.isSet('locked_mev_reward')
      ? vaultReward.mustGet('locked_mev_reward').toBigInt()
      : BigInt.zero()
    const unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const consensusReward = vaultReward.mustGet('consensus_reward').toBigInt()
    const executionReward = unlockedMevReward.plus(lockedMevReward)
    const proof = vaultReward.mustGet('proof').toArray()

    // calculate period rewards
    let periodConsensusReward: BigInt, periodExecutionReward: BigInt
    if (vault.isGenesis) {
      // period reward is calculated during harvest
      periodConsensusReward = BigInt.zero()
      periodExecutionReward = BigInt.zero()
    } else if (vault.proofReward === null) {
      // the first rewards update, no delta
      periodConsensusReward = consensusReward
      periodExecutionReward = executionReward
    } else {
      // calculate delta from previous update
      periodConsensusReward = consensusReward.minus(vault.consensusReward)
      periodExecutionReward = executionReward.minus(vault.lockedExecutionReward.plus(vault.unlockedExecutionReward))
    }

    // calculate smoothing pool penalty
    let slashedMevReward = vault.slashedMevReward
    if (vault.lockedExecutionReward.gt(lockedMevReward) && vault.unlockedExecutionReward.ge(unlockedMevReward)) {
      slashedMevReward = slashedMevReward.plus(vault.lockedExecutionReward.minus(lockedMevReward))
    }

    // calculate proof values for state update
    let proofReward: BigInt
    let proofUnlockedMevReward: BigInt
    if (vault.mevEscrow !== null) {
      // vault has own mev escrow, proof reward is consensus reward, nothing can be slashed
      proofReward = consensusReward
      slashedMevReward = BigInt.zero()
      proofUnlockedMevReward = BigInt.zero()
    } else {
      // vault uses shared mev escrow, proof reward is consensus reward + total mev reward
      proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
      proofUnlockedMevReward = unlockedMevReward
    }

    if (!vault.isGenesis) {
      // genesis vault apy is updated during harvest
      if (rewardsIpfsHash == IGNORED_APY_CALC_OWN_MEV_IPFS_HASH && vault.mevEscrow !== null) {
        // skip for vaults with own mev escrow for the first rewards update
        log.warning('[Keeper] RewardsUpdated Skipping execution rewards update for vault={}', [vaultId])
        updateVaultApy(vault, vault.rewardsTimestamp, updateTimestamp, periodConsensusReward, BigInt.fromI32(0))
      } else {
        updateVaultApy(vault, vault.rewardsTimestamp, updateTimestamp, periodConsensusReward, periodExecutionReward)
      }
    }

    // update vault state
    vault.totalAssets = vault.totalAssets.plus(periodConsensusReward).plus(periodExecutionReward)
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = proofUnlockedMevReward
    vault.consensusReward = consensusReward
    vault.lockedExecutionReward = lockedMevReward
    vault.unlockedExecutionReward = unlockedMevReward
    vault.slashedMevReward = slashedMevReward
    vault.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    vault.save()
  }
}

export function handleRewardsUpdated(event: RewardsUpdated): void {
  const rewardsRoot = event.params.rewardsRoot
  const rewardsIpfsHash = event.params.rewardsIpfsHash
  const updateTimestamp = event.params.updateTimestamp

  const callbackData = Value.fromArray([
    Value.fromBytes(rewardsRoot),
    Value.fromBigInt(updateTimestamp),
    Value.fromString(rewardsIpfsHash),
  ])

  ipfs.mapJSON(rewardsIpfsHash, 'updateRewards', callbackData)
  log.info('[Keeper] RewardsUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
    updateTimestamp.toString(),
  ])
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  let totalAssetsDelta = event.params.totalAssetsDelta
  const vaultAddress = event.params.vault.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  if (!vault.isGenesis) {
    vault.principalAssets = vault.totalAssets
    vault.save()
    log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
  } else {
    const v2Pool = createOrLoadV2Pool()
    if (!v2Pool.migrated) {
      v2Pool.migrated = true
      v2Pool.save()
    }
  }
}
