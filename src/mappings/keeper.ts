import { BigInt, ipfs, JSONValue, log, Value } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'
import { Harvested, RewardsUpdated } from '../../generated/Keeper/Keeper'
import { updateAvgRewardPerAsset, updateDaySnapshots } from '../entities/daySnapshot'

function calculateSlashedMevReward(
  prevSlashedMevReward: BigInt | null,
  newLockedMevReward: BigInt,
  newUnlockedMevReward: BigInt,
  prevLockedMevReward: BigInt | null,
  prevUnlockedMevReward: BigInt | null,
): BigInt {
  let totalPrevMevReward: BigInt
  if (prevUnlockedMevReward === null) {
    totalPrevMevReward = BigInt.zero()
  } else {
    totalPrevMevReward = (prevLockedMevReward as BigInt).plus(prevUnlockedMevReward as BigInt)
  }
  const totalDelta = newLockedMevReward.plus(newUnlockedMevReward).minus(totalPrevMevReward).abs()

  if (prevSlashedMevReward === null) {
    return totalDelta
  } else {
    return (prevSlashedMevReward as BigInt).plus(totalDelta)
  }
}

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
      log.warning('[Keeper] RewardsUpdated vault={} not found', [vaultId])
      continue
    }

    // extract vault reward data
    const consensusReward = vaultReward.mustGet('consensus_reward').toBigInt()
    const lockedMevReward = vaultReward.isSet('locked_mev_reward')
      ? vaultReward.mustGet('locked_mev_reward').toBigInt()
      : BigInt.zero()
    const unlockedMevReward = vaultReward.mustGet('unlocked_mev_reward').toBigInt()
    const proof = vaultReward.mustGet('proof').toArray()

    // calculate new vault rewards
    const newTotalReward = consensusReward.plus(unlockedMevReward).plus(lockedMevReward)
    let periodReward: BigInt
    if (vault.rewardsTimestamp !== null) {
      periodReward = newTotalReward.minus(vault.totalReward as BigInt)
      // it's the second or later update, start creating snapshots
      updateDaySnapshots(vault, vault.rewardsTimestamp as BigInt, updateTimestamp, periodReward)
    } else {
      periodReward = newTotalReward
    }

    let proofReward: BigInt
    let proofUnlockedMevReward: BigInt
    let slashedMevReward: BigInt
    if (vault.mevEscrow !== null) {
      // vault has own mev escrow, proof reward is consensus reward, nothing can be slashed
      proofReward = consensusReward
      slashedMevReward = BigInt.zero()
      proofUnlockedMevReward = BigInt.zero()
    } else {
      // vault uses shared mev escrow, proof reward is consensus reward + total mev reward
      proofReward = consensusReward.plus(lockedMevReward).plus(unlockedMevReward)
      // calculate slashed mev reward
      slashedMevReward = calculateSlashedMevReward(
        vault.slashedMevReward,
        lockedMevReward,
        unlockedMevReward,
        vault.lockedMevReward,
        vault.proofUnlockedMevReward,
      )
      proofUnlockedMevReward = unlockedMevReward
    }

    // update vault state
    vault.totalReward = newTotalReward
    vault.totalAssets = vault.totalAssets.plus(periodReward)
    vault.rewardsRoot = rewardsRoot
    vault.proofReward = proofReward
    vault.proofUnlockedMevReward = proofUnlockedMevReward
    vault.lockedMevReward = lockedMevReward
    vault.slashedMevReward = slashedMevReward
    vault.proof = proof.map<string>((proofValue: JSONValue) => proofValue.toString())
    vault.rewardsTimestamp = updateTimestamp
    vault.rewardsIpfsHash = rewardsIpfsHash
    updateAvgRewardPerAsset(updateTimestamp, vault)
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
  if (rewardsIpfsHash == 'bafkreigsvnhlb5mkuvosuzg4bkmtbhh4cxdlhqs54xvrn35zxnb2uvvpei') {
    log.warning('[Keeper] RewardsUpdated rewardsIpfsHash={} is invalid', [rewardsIpfsHash])
    return
  }

  ipfs.mapJSON(rewardsIpfsHash, 'updateRewards', callbackData)
  log.info('[Keeper] RewardsUpdated rewardsRoot={} rewardsIpfsHash={} updateTimestamp={}', [
    rewardsRoot.toHex(),
    rewardsIpfsHash,
    updateTimestamp.toString(),
  ])
}

// Event emitted on Keeper assets harvest
export function handleHarvested(event: Harvested): void {
  const totalAssetsDelta = event.params.totalAssetsDelta
  const vaultAddress = event.params.vault.toHex()

  const vault = Vault.load(vaultAddress) as Vault
  vault.principalAssets = vault.principalAssets.plus(totalAssetsDelta)
  vault.save()

  log.info('[Keeper] Harvested vault={} totalAssetsDelta={}', [vaultAddress, totalAssetsDelta.toString()])
}
