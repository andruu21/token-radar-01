# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/andruu21/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/andruu21/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama protocol snapshot, scores every protocol that
records no token yet, ranks the board by implied value, and hands the reader a farm plan for each
protocol — what to do, what it costs, and how long it takes.

## The value model

```
implied_value = TVL × 0.25 × growth × maturity × premium × scarcity
growth   = 1 + clamp(change_7d, -60, 120)/100 × 0.5
maturity = 0.6 + min(age_days, 1095)/1095 × 0.4
premium  = category premium 1.00–1.12, matched on category keywords, never a name
scarcity = 1 + 0.25 × (1 − age/240), floored at 1.00
```

One function scores every row (`buildBoard` in `lib/model.ts`); no protocol name is special-cased.
Protocols whose token already trades are kept apart in a live-token table priced by the market.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

## Dashboard

`dashboard/` is a static page, no framework and no network: it reads `data.js` (written beside it by
`main.ts`), renders the ranked board with sort, search and category filter, and opens a detail drawer
per protocol that recomputes the model in the open and lays out the farm plan with costs and times.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
