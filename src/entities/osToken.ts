import {Address, BigDecimal, BigInt} from '@graphprotocol/graph-ts'
import { OsToken, OsTokenSnapshot, OsTokenHolder } from '../../generated/schema'

const osTokenId = '1'

export function createOrLoadOsToken(): OsToken {
  let osToken = OsToken.load(osTokenId)
  if (osToken === null) {
    osToken = new OsToken(osTokenId)

    osToken.apy = BigDecimal.zero()
    osToken.totalSupply = BigInt.zero()
    osToken.snapshotsCount = BigInt.zero()
    osToken.save()
  }

  return osToken
}

export function createOrLoadOsTokenHolder(
  holderAddress: Address,
): OsTokenHolder {
  let holderId = holderAddress.toHexString();
  let holder = OsTokenHolder.load(holderId);
  if (holder == null) {
    holder = new OsTokenHolder(holderId);
    holder.shares = BigInt.zero();
    holder.timestamp = BigInt.zero();
    holder.save();
  }
  return holder as OsTokenHolder;
}

export function isSupportedOsTokenHolder(holderAddress: Address): boolean {
  return (
    holderAddress != Address.zero()
  );
}
