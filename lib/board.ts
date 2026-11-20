// The board: which protocols it ranks, in what order, and how the reader farms each one.
//
// The watchlist is the floor, never the ceiling: every slug on it is carried, and the early rows
// below the floor are the protocols the radar exists to find before anyone else is watching. Each
// row keeps the model's own parts (growth, maturity, premium, scarcity) so the page can show its
// arithmetic, and the farm plan is written per protocol from its own record — its category decides
// the action, its chains decide the gas, its TVL decides the capital, its age decides the hold.

import type { Protocol, Snapshot } from './score.ts';
import { CONSTANTS, indexBySlug, isRankable, MODEL_VERSION, valueOf } from './score.ts';

/** How many early rows below the watchlist floor the board carries, the largest first. */
export const EARLY_ROWS = 360;

/** How many live-token protocols the page shows set aside, priced by the market. */
export const LIVE_ROWS = 24;

/** A farm step as the reader follows it: the action, then what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    growth: number;
    maturity: number;
    premium: number;
    scarcity: number;
  };
  farm_steps: string[];
  watchlist: boolean;
}

/** The dashboard's view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: { growth: number; maturity: number; premium: number; scarcity: number };
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the market's own price stands in for the model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the page renders, written into data.js beside the dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  constants: Record<string, number>;
  watchlist_size: number;
  watchlist_on_board: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const four = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The board: watchlist first, then the early rows, ranked by implied value, ties by slug. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, parts: valueOf(p, snapshot.as_of) }));
  scored.sort((a, b) => b.parts.implied - a.parts.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.parts.age,
    implied_value_usd: s.parts.implied,
    model: {
      growth: four(s.parts.growth),
      maturity: four(s.parts.maturity),
      premium: four(s.parts.premium),
      scarcity: four(s.parts.scarcity),
    },
    farm_steps: farmPlan(s.p, s.parts.age),
    watchlist: snapshot.watchlist.includes(s.p.slug),
  }));
}

/** A step as one string the gate accepts: the action, then its cost and its time. */
function stepLine(step: FarmStep): string {
  let line = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line += " Hold the position and check the protocol's own page.";
  return line;
}

/** The first chain the record names, or a neutral phrase when it names none. */
function mainChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A first-transaction gas range for the chain: mainnet Ethereum costs, L2s and Solana cost less. */
function gasOn(p: Protocol): string {
  const chains = p.chains.map((c) => c.toLowerCase());
  if (chains.includes('ethereum')) return '$10-25';
  if (chains.some((c) => c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('polygon'))) return '$0.10-1';
  if (chains.includes('solana') || chains.includes('sui') || chains.includes('aptos')) return 'under $0.05';
  return '$1-5';
}

/** How much capital one farm position needs, scaled to the protocol's own size. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold: a younger protocol has a longer qualifying window ahead of its launch. */
function holdFor(ageDays: number | null): number {
  if (ageDays === null) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** The one action this category calls for, in words a farmer can follow with a wallet open. */
function actionFor(p: Protocol, capital: number, chain: string): string {
  const kind = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (kind.includes('dex') || kind.includes('yield')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (kind.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (kind.includes('staking') || kind.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (kind.includes('perpetual') || kind.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (kind.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (kind.includes('curator') || kind.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (kind.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (kind.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (kind.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * The protocol's farm plan: six steps, each with what it costs and how long it takes. Every step
 * follows from the record — the category, the chains, the TVL, the age — never from a name.
 */
export function farmPlan(p: Protocol, ageDays: number | null): string[] {
  const chain = mainChain(p);
  const capital = capitalFor(p);
  const hold = holdFor(ageDays);
  const steps: FarmStep[] = [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: `${gasOn(p)} of gas for the first transaction on ${chain}`, time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
  ];
  return steps.map(stepLine);
}

/** The live-token protocols, the largest market cap first, for the page's set-aside table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isRankable(p) || p.category === 'CEX')
    .filter((p) => !p.gecko_id && !p.symbol ? false : true)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** One board row in the page's compact form. */
function toRadarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    model: row.model,
    watchlist: row.watchlist,
  };
}

/** The board, the live set and the constants in one object for data.js. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    constants: { ...CONSTANTS },
    watchlist_size: snapshot.watchlist.length,
    watchlist_on_board: board.filter((r) => r.watchlist).length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    rows: board.map(toRadarRow),
    live,
  };
  return { board, radar };
}

/** Why the gate would refuse this board, or null when every check holds. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all rows share one implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script line: no fetch, no network, every byte inline. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

export { ageInDays, isRankable, MODEL_VERSION, parseSnapshot, readSnapshot, valueOf } from './score.ts';
