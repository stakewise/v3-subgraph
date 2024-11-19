import {
    ExitedAssetsClaimed as OsTokenExitedAssetsClaimed,
    ExitedAssetsProcessed, OsTokenLiquidated, OsTokenRedeemed,
    PositionCreated
} from "../../generated/AaveLeverageStrategy/OsTokenVaultEscrow";
import {createOsTokenExitRequest, updateOsTokenExitRequest} from "../entities/osTokenExitRequest";
import {createOrLoadOsToken} from "../entities/osToken";
import {ExitRequest, OsTokenExitRequest, Vault} from "../../generated/schema";
import {BigInt, ethereum, log} from "@graphprotocol/graph-ts";
import {createOrLoadNetwork} from "../entities/network";
import {getExitRequestLtv} from "./leverageStrategy";

export function handlePositionCreated(event: PositionCreated): void {
  const vaultAddress = event.params.vault
  const owner = event.params.owner
  const osTokenShares = event.params.osTokenShares
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = createOsTokenExitRequest(osTokenExitRequestId, vaultAddress, owner)
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  const osToken = createOrLoadOsToken()
  osTokenExitRequest.ltv = getExitRequestLtv(osTokenShares, exitRequest.exitedAssets, exitRequest.totalAssets, osToken)
  osTokenExitRequest.osTokenShares = osTokenShares
  osTokenExitRequest.save()

  log.info('[LeverageStrategy] osTokenExitRequestCreated vault={} owner={} exitPositionTicket={}', [
    vaultAddress.toHex(),
    owner.toHex(),
    exitPositionTicket.toHex(),
  ])
}

export function handleExitedAssetsProcessed(event: ExitedAssetsProcessed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const exitedAssets = event.params.exitedAssets
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[osTokenExitRequest] osTokenExitRequest={} not found', [osTokenExitRequestId])
    return
  }
  let osTokenExitedAssets = osTokenExitRequest.exitedAssets
  if (osTokenExitedAssets === null) {
    osTokenExitedAssets = BigInt.zero()
  }
  osTokenExitRequest.exitedAssets = osTokenExitedAssets.plus(exitedAssets)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )

  osTokenExitRequest.save()

  log.info('[OsTokenExitRequest] ExitedAssetsProcessed vault={} exitPositionTicket={} exitedAssets={}', [
    vaultAddress.toHex(),
    exitedAssets.toHex(),
  ])
}

export function handleOsTokenExitedAssetsClaimed(event: OsTokenExitedAssetsClaimed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[osTokenExitRequest] osTokenExitRequest={} not found', [osTokenExitRequestId])
    return
  }
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )
  osTokenExitRequest.save()

  log.info('[OsTokenExitRequest] OsTokenExitedAssetsClaimed vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenLiquidated(event: OsTokenLiquidated): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[osTokenExitRequest] osTokenExitRequest={} not found', [osTokenExitRequestId])
    return
  }
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )
  osTokenExitRequest.save()

  log.info('[OsTokenExitRequest] OsTokenLiquidated vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenRedeemed(event: OsTokenRedeemed): void {
  const vaultAddress = event.params.vault
  const exitPositionTicket = event.params.exitPositionTicket
  const osTokenShares = event.params.osTokenShares
  const osTokenExitRequestId = `${vaultAddress}-${exitPositionTicket}`

  const osTokenExitRequest = OsTokenExitRequest.load(osTokenExitRequestId)
  if (osTokenExitRequest == null) {
    log.error('[osTokenExitRequest] osTokenExitRequest={} not found', [osTokenExitRequestId])
    return
  }
  osTokenExitRequest.osTokenShares = osTokenExitRequest.osTokenShares.minus(osTokenShares)
  const osToken = createOrLoadOsToken()
  const exitRequest = ExitRequest.load(osTokenExitRequestId as string) as ExitRequest
  osTokenExitRequest.ltv = getExitRequestLtv(
    osTokenExitRequest.osTokenShares,
    exitRequest.exitedAssets,
    exitRequest.totalAssets,
    osToken,
  )
  osTokenExitRequest.save()

  log.info('[OsTokenExitRequest] OsTokenRedeemed vault={} exitPositionTicket={} osTokenShares={}', [
    vaultAddress.toHex(),
    exitPositionTicket.toHex(),
    osTokenShares.toHex(),
  ])
}

export function handleOsTokenExitRequests(block: ethereum.Block): void {
  const network = createOrLoadNetwork()
  let vault: Vault
  for (let i = 0; i < network.vaultIds.length; i++) {
    vault = Vault.load(network.vaultIds[i]) as Vault
    updateOsTokenExitRequest(vault)
  }
  log.info('[OsTokenExitRequests] Sync handle osToken exit requests at block={}', [block.number.toString()])
}