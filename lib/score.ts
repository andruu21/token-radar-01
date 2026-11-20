// The sealed snapshot, and the value model that turns it into one implied value per protocol.
//
// A protocol's launch is the token it may issue one day. This file asks what that token would be
// worth if the protocol's record stayed as it is, using only the snapshot's own ten fields:
//
//   implied_value = tvl_usd × BASE × growth × maturity × premium × scarcity
//
//   growth    = 1 + clamp(change_7d, -60, 120) / 100 × GROWTH_WEIGHT
//   maturity  = 0.6 + min(age_days, 1095) / 1095 × 0.4         (no listed_at: 365 days)
//   premium   = a category multiplier, matched on the category's words, 1.00 to 1.12
//   scarcity  = 1 + 0.25 × (1 − age / 240), never below 1.00    (no listed_at: ×1.04)
//
// No protocol name is read anywhere in this file: the same function scores every row, and the
// same constants are what the dashboard prints above its board.

import { readFileSync } from 'node:fs';

/** The ten fields the sealed snapshot carries for one protocol, and no others. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot: the fetch's date and source, the floor, every protocol, and the watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's constants. The dashboard prints them, and one edit here moves every row. */
export const CONSTANTS = {
  /** What a dollar of TVL is worth before growth, age and category move it. */
  base: 0.25,
  /** How much of the seven-day change counts, so one wild week cannot carry a row. */
  growthWeight: 0.5,
  growthFloor: -60,
  growthCap: 120,
  /** A protocol that has run longer is likelier to issue, so age lifts the multiple to here. */
  maturityFloor: 0.6,
  maturityRange: 0.4,
  maturityDays: 1095,
  /** An unlisted protocol is treated as this old: the middle of the record, not a fresh launch. */
  unknownAgeDays: 365,
  /** The window in which a young, large protocol still owes its users the most unclaimed value. */
  scarcityDays: 240,
  scarcityMax: 0.25,
  unknownAgeMultiplier: 1.04,
} as const;

/** The label the page shows beside every figure, so a reader knows which arithmetic ran. */
export const MODEL_VERSION = 'radar-2';

/** A snapshot that is not the shape this model scores. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY = 86_400_000;

/** A finite number, else `fallback`. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, floored at zero; null when either date is missing or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY));
}

/**
 * The category premium: what a dollar of TVL is worth in a protocol that may still issue a token,
 * by the kind of protocol it is. Vaults, market makers and basis traders have produced the
 * strongest launches, so their TVL carries a premium; plain liquidity venues carry almost none.
 * The match is on the category DefiLlama names, never on the protocol's name.
 */
export function premiumFor(category: string | null): number {
  const words = (category ?? '').toLowerCase();
  if (words.includes('rwa') || words.includes('real world')) return 1.12;
  if (words.includes('basis') || words.includes('delta')) return 1.1;
  if (words.includes('derivative') || words.includes('perpetual')) return 1.08;
  if (words.includes('cdp') || words.includes('collateral') || words.includes('stable')) return 1.06;
  if (words.includes('lending')) return 1.05;
  if (words.includes('yield')) return 1.04;
  if (words.includes('insurance') || words.includes('prediction')) return 1.03;
  if (words.includes('dex') || words.includes('liquidity')) return 1.02;
  return 1.0;
}

/**
 * The scarcity multiplier: a protocol that reached size quickly has had the least time to reward
 * its users, so the token it has not issued yet carries the most unclaimed value. It decays to
 * 1.00 at the end of the window; a protocol with no listed date gets a small fixed lift instead.
 */
export function scarcityFor(ageDays: number | null): number {
  if (ageDays === null) return CONSTANTS.unknownAgeMultiplier;
  if (ageDays >= CONSTANTS.scarcityDays) return 1;
  return 1 + CONSTANTS.scarcityMax * (1 - ageDays / CONSTANTS.scarcityDays);
}

/** One row's arithmetic, kept as its own parts so the page can show each step. */
export interface ValueParts {
  implied: number;
  growthPct: number;
  growth: number;
  maturity: number;
  premium: number;
  scarcity: number;
  age: number | null;
}

/** The five multipliers and the implied value one protocol gets. */
export function valueOf(protocol: Protocol, asOf: string): ValueParts {
  const age = ageInDays(asOf, protocol.listed_at);
  const growthPct = Math.min(CONSTANTS.growthCap, Math.max(CONSTANTS.growthFloor, num(protocol.change_7d, 0)));
  const growth = 1 + (growthPct / 100) * CONSTANTS.growthWeight;
  const ageForModel = age ?? CONSTANTS.unknownAgeDays;
  const capped = Math.min(Math.max(ageForModel, 0), CONSTANTS.maturityDays);
  const maturity = CONSTANTS.maturityFloor + (capped / CONSTANTS.maturityDays) * CONSTANTS.maturityRange;
  const premium = premiumFor(protocol.category);
  const scarcity = scarcityFor(age);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * CONSTANTS.base * growth * maturity * premium * scarcity));
  return { implied, growthPct, growth, maturity, premium, scarcity, age };
}

/** DefiLlama's version-marker rule: a name that ends in a release is a pool of another protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the record carries no token at all: no market cap, no CoinGecko id, no ticker. */
export function hasNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol may be ranked: it records no token, and is not an exchange or a versioned pool. */
export function isRankable(p: Protocol): boolean {
  return hasNoToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

/** One protocol of the snapshot by its slug. */
export function indexBySlug(protocols: Protocol[]): Map<string, Protocol> {
  const index = new Map<string, Protocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** Read a snapshot from a file and refuse it unless it is the shape this model scores. */
export function readSnapshot(path: string): Snapshot {
  return parseSnapshot(readFileSync(path, 'utf8'));
}

/** Parse a snapshot's text, refusing anything the model cannot score. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    } satisfies Protocol;
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
