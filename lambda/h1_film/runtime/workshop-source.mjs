// Publication provenance is an unverified locator, never a replay map pin.
export const MCC_APP_ID = 976730;

export function workshopItemId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)
      || BigInt(value) > 0xffffffffffffffffn) throw new Error('Invalid Workshop item ID');
  return value;
}

// Pass an entire standalone/outer film, or a sliced part with rebased offsets.
// Unknown and malformed optional provenance follows the engine's unknown semantics.
export function readWorkshopSource(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 504
      || bytes.readUInt32LE(0) !== 0x314d4c46 || bytes.readUInt32LE(4) !== 3
      || !(bytes.readUInt32LE(28) & 0x80)) return null;
  const header = bytes.readUInt32LE(64), options = bytes.readUInt32LE(72);
  const start = options - 24;
  if (![504, 536].includes(header) || start < header || options > bytes.length) return null;
  if (bytes.readUInt32LE(start) !== 0x3150414d
      || bytes.readUInt32LE(start + 4) !== 1 || bytes.readUInt32LE(start + 8) !== 24) return null;
  const app = bytes.readUInt32LE(start + 12), item = bytes.readBigUInt64LE(start + 16);
  if (app !== MCC_APP_ID || item === 0n) return null;
  return {app_id: app, item_id: item.toString(), provenance: 'film_map1_v1'};
}

// A metadata change schedules ingestion; it does not select a map for playback.
export function workshopRevision(details, itemId) {
  workshopItemId(itemId);
  if (details?.result !== 1 || details.consumer_app_id !== MCC_APP_ID
      || details.publishedfileid !== itemId || !Number.isSafeInteger(details.time_updated)
      || details.time_updated < 0) throw new Error('Unavailable or invalid MCC Workshop metadata');
  return {app_id: MCC_APP_ID, item_id: itemId, time_updated: details.time_updated};
}

export function needsWorkshopRefresh(previous, current) {
  return !previous || previous.app_id !== current.app_id || previous.item_id !== current.item_id
    || previous.time_updated !== current.time_updated;
}
