// Token Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked pre-token board, a sortable and filterable table, and a per-protocol detail drawer that
// recomputes the model in the open and lays out the farm plan with its costs and times. No
// network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', sort: 'implied', dir: -1, selected: null };
  var C = DATA.constants; // the model's constants, the same object lib/score.ts prints

  // ---- formatting ---------------------------------------------------------------------------

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // ---- the model, recomputed in the page ----------------------------------------------------
  //
  // The same arithmetic lib/score.ts runs, checked against the number board.json carries, so a
  // reader can see the code and the data agree. No protocol name is special-cased anywhere.

  function premiumFor(category) {
    var words = (category || '').toLowerCase();
    if (words.indexOf('rwa') >= 0 || words.indexOf('real world') >= 0) return 1.12;
    if (words.indexOf('basis') >= 0 || words.indexOf('delta') >= 0) return 1.1;
    if (words.indexOf('derivative') >= 0 || words.indexOf('perpetual') >= 0) return 1.08;
    if (words.indexOf('cdp') >= 0 || words.indexOf('collateral') >= 0 || words.indexOf('stable') >= 0) return 1.06;
    if (words.indexOf('lending') >= 0) return 1.05;
    if (words.indexOf('yield') >= 0) return 1.04;
    if (words.indexOf('insurance') >= 0 || words.indexOf('prediction') >= 0) return 1.03;
    if (words.indexOf('dex') >= 0 || words.indexOf('liquidity') >= 0) return 1.02;
    return 1.0;
  }

  function scarcityFor(ageDays) {
    if (ageDays === null || ageDays === undefined) return C.unknownAgeMultiplier;
    if (ageDays >= C.scarcityDays) return 1;
    return 1 + C.scarcityMax * (1 - ageDays / C.scarcityDays);
  }

  function impliedOf(row) {
    var growth = Math.min(C.growthCap, Math.max(C.growthFloor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var g = 1 + (growth / 100) * C.growthWeight;
    var age = row.age_days === null || row.age_days === undefined ? C.unknownAgeDays : row.age_days;
    var capped = Math.min(Math.max(age, 0), C.maturityDays);
    var maturity = C.maturityFloor + (capped / C.maturityDays) * C.maturityRange;
    return Math.max(1, Math.round(row.tvl_usd * C.base * g * maturity * premiumFor(row.category) * scarcityFor(row.age_days)));
  }

  // ---- the farm plan, derived from the record ------------------------------------------------
  //
  // The category decides the action, the chains decide the gas, the TVL decides the capital, the
  // age decides the hold — the same derivation lib/board.ts writes into board.json.

  function mainChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  function gasOn(p) {
    var chains = (p.chains || []).map(function (c) { return (c || '').toLowerCase(); });
    if (chains.indexOf('ethereum') >= 0) return '$10-25';
    if (chains.some(function (c) { return c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('polygon') >= 0; })) return '$0.10-1';
    if (chains.indexOf('solana') >= 0 || chains.indexOf('sui') >= 0 || chains.indexOf('aptos') >= 0) return 'under $0.05';
    return '$1-5';
  }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function actionFor(p, capital, chain) {
    var kind = (p.category || '').toLowerCase();
    var name = p.name;
    if (kind.indexOf('lend') >= 0 || kind.indexOf('cdp') >= 0 || kind.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (kind.indexOf('dex') >= 0 || kind.indexOf('yield') >= 0) return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + " and keep the position open.";
    if (kind.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (kind.indexOf('staking') >= 0 || kind.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (kind.indexOf('perpetual') >= 0 || kind.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (kind.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (kind.indexOf('curator') >= 0 || kind.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (kind.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (kind.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (kind.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  function stepLine(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(p) {
    var chain = mainChain(p);
    var capital = capitalFor(p);
    var hold = holdFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gasOn(p) + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepLine);
  }

  // ---- small DOM helper ---------------------------------------------------------------------

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else node.appendChild(child);
    }
    return node;
  }

  // ---- state in the URL hash, so a view can be shared ---------------------------------------

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ---- filtering and sorting ----------------------------------------------------------------

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return va < vb ? -dir : va > vb ? dir : 0; }
      if (key === 'growth') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      return (va - vb) * dir || (a.rank - b.rank);
    });
  }

  // ---- sections -----------------------------------------------------------------------------

  function header() {
    return el('header', { class: 'hero' },
      el('h1', null, el('span', { class: 'fin', text: '▲ Token Radar' })),
      el('span', { class: 'sub', text: 'Pre-token protocols ranked by implied value · snapshot ' + DATA.as_of + ' · model ' + DATA.model_version }));
  }

  function statline() {
    return el('div', { class: 'statline' },
      el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Rows scored' }), el('div', { class: 'v', text: String(DATA.board_size) })),
      el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Watchlist covered' }), el('div', { class: 'v', text: DATA.watchlist_on_board + '/' + DATA.watchlist_size })),
      el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Early rows under floor' }), el('div', { class: 'v', text: String(DATA.early_size) })),
      el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Live tokens set aside' }), el('div', { class: 'v plain', text: String(DATA.live_size) })),
      el('div', { class: 'stat' }, el('div', { class: 'k', text: 'Watchlist floor' }), el('div', { class: 'v plain', text: fmtUsd(DATA.floor_usd) })));
  }

  function modelCard() {
    return el('section', { class: 'modelcard' },
      el('h2', { text: 'The value model' }),
      el('div', { class: 'formula', text:
        'implied_value = TVL × ' + C.base + ' × growth × maturity × premium × scarcity\n' +
        'growth    = 1 + clamp(change_7d, ' + C.growthFloor + ', ' + C.growthCap + ')/100 × ' + C.growthWeight + '\n' +
        'maturity  = ' + C.maturityFloor + ' + min(age_days, ' + C.maturityDays + ')/' + C.maturityDays + ' × ' + C.maturityRange + '   (unknown age → ' + C.unknownAgeDays + 'd)\n' +
        'premium   = category premium 1.00–1.12 (RWA 1.12, basis 1.10, perps 1.08, CDP 1.06, lending 1.05, yield 1.04, dex 1.02)\n' +
        'scarcity  = 1 + ' + C.scarcityMax + ' × (1 − age/' + C.scarcityDays + '), floored at 1.00   (unknown age → ×' + C.unknownAgeMultiplier + ')'
      }),
      el('p', { text: 'Every figure comes from the sealed snapshot: TVL and its seven-day change, the category DefiLlama names, and how long the protocol has run with no token on record. One function scores all ' + DATA.board_size + ' rows — no name is special-cased. Protocols whose token already trades are set aside with the market\'s own value, never mixed into this ranking. This is an entry\'s estimate, not a price.' }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories (' + DATA.rows.length + ')' }),
      categories.map(function (c) {
        var n = DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length;
        var o = el('option', { value: c, text: c + ' (' + n + ')' });
        if (c === state.category) o.setAttribute('selected', 'selected');
        return o;
      }));
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var clear = el('button', { type: 'button', class: 'chip', text: 'Clear', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } });
    return el('div', { class: 'controls' }, search, select, clear,
      el('span', { class: 'count', text: rows().length + ' of ' + DATA.rows.length + ' rows shown' }));
  }

  function sortHeader(key, label) {
    var th = el('th', { scope: 'col', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); }, text: label });
    if (state.sort === key) th.appendChild(el('span', { class: 'arrow', text: state.dir < 0 ? '▼' : '▲' }));
    return th;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) return el('div', { class: 'empty', text: 'No protocol matches that filter. Clear the search or pick another category.' });
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var tr = el('tr', { tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter') openDetail(r.slug); } },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', { class: 'name' }, el('span', { text: r.name }), el('span', { class: 'slug', text: r.slug }), r.watchlist ? el('span', { class: 'watchbadge', text: 'WATCHLIST' }) : null),
        el('td', null, el('span', { class: 'cat ' + (r.category || '').toLowerCase().replace(/\s+/g, '-'), text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: g }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num imp', text: fmtUsd(r.implied_value_usd) }),
        el('td', null, el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' }))));
      if (r.watchlist) tr.classList.add('watch');
      tbody.appendChild(tr);
    });
    return el('div', { class: 'tablewrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          el('th', { scope: 'col', text: 'Category' }),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'No-token age'),
          sortHeader('implied', 'Implied value'),
          el('th', { scope: 'col', text: 'Share of #1' }))),
        tbody));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'name' }, el('span', { text: r.name })),
        el('td', null, el('span', { class: 'cat', text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a' })));
    });
    return el('section', { class: 'live' },
      el('h2', { text: 'Live tokens — set aside, priced by the market' }),
      el('div', { class: 'tablewrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'MCap/TVL' }))),
          tbody)));
  }

  // ---- the detail drawer --------------------------------------------------------------------

  var scrim = el('div', { class: 'scrim', style: 'display:none', onclick: closeDetail });
  var drawer = el('aside', { class: 'drawer', style: 'display:none', 'aria-label': 'Protocol detail' });

  function closeDetail() {
    state.selected = null;
    writeHash();
    drawer.style.display = 'none';
    scrim.style.display = 'none';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row);
    var steps = farmSteps(row);
    drawer.textContent = '';
    drawer.appendChild(el('button', { class: 'close', type: 'button', text: 'Close ✕', onclick: closeDetail }));
    drawer.appendChild(el('h2', { text: row.name }));
    drawer.appendChild(el('div', { class: 'slugline', text: row.slug + ' · rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.watchlist ? ' · on the house watchlist' : ' · early: under the watchlist floor') }));
    drawer.appendChild(el('div', { class: 'bigimp', text: fmtUsd(row.implied_value_usd) }));
    drawer.appendChild(el('div', { class: 'biglab', text: 'Implied value if the record stands' }));
    var catRows = DATA.rows.filter(function (r) { return r.category === row.category; });
    var catRank = catRows.filter(function (r) { return r.implied_value_usd > row.implied_value_usd; }).length + 1;
    var share = Math.round((row.implied_value_usd / DATA.rows[0].implied_value_usd) * 1000) / 10;
    drawer.appendChild(el('div', { class: 'slugline', text: '#' + catRank + ' of ' + catRows.length + ' in ' + (row.category || 'Other') + ' · ' + share + "% of the board's #1" }));
    drawer.appendChild(el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'fact' }, el('div', { class: 'k', text: '7-day change' }), el('div', { class: 'v ' + (row.change_7d !== null && row.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(row.change_7d) })),
      el('div', { class: 'fact' }, el('div', { class: 'k', text: 'No-token age' }), el('div', { class: 'v', text: fmtAge(row.age_days) })),
      el('div', { class: 'fact' }, el('div', { class: 'k', text: 'Listed at' }), el('div', { class: 'v', text: row.listed_at || 'unknown' }))));
    drawer.appendChild(el('div', { class: 'mults' },
      el('div', { class: 'mrow' }, el('span', { text: 'Base = TVL × ' + C.base }), el('span', { class: 'mv', text: fmtUsd(Math.round(row.tvl_usd * C.base)) })),
      el('div', { class: 'mrow' }, el('span', { text: '× growth (' + (row.change_7d === null ? 'n/a' : row.change_7d.toFixed(2) + '%') + ')' }), el('span', { class: 'mv', text: '×' + row.model.growth })),
      el('div', { class: 'mrow' }, el('span', { text: '× maturity (' + fmtAge(row.age_days) + ' old)' }), el('span', { class: 'mv', text: '×' + row.model.maturity })),
      el('div', { class: 'mrow' }, el('span', { text: '× category premium' }), el('span', { class: 'mv', text: '×' + row.model.premium })),
      el('div', { class: 'mrow' }, el('span', { text: '× scarcity of the unissued token' }), el('span', { class: 'mv', text: '×' + row.model.scarcity })),
      el('div', { class: 'mrow' }, el('span', { text: '= implied value' }), el('span', { class: 'mv', text: fmtUsd(row.implied_value_usd) }))));
    drawer.appendChild(el('p', { class: 'footnote', text: 'The page recomputes this row to ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries, so the code and the data agree.' : ' — which differs from the board: the data would be stale.') }));
    var plan = el('div', null, el('h3', { text: 'Farm plan — what to do, what it costs, how long it takes' }));
    steps.forEach(function (s, i) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 7) : '';
      var cost = tail;
      var time = '';
      var tAt = tail.indexOf('. Time: ');
      if (tAt >= 0) { cost = tail.slice(0, tAt + 1); time = tail.slice(tAt + 8).replace(/\.$/, ''); }
      plan.appendChild(el('div', { class: 'step' },
        el('div', { class: 'n', text: String(i + 1) }),
        el('div', null, el('div', { text: action }), el('div', { class: 'meta' }, el('span', { class: 'cost', text: cost + ' · ' }), el('span', { text: time })))));
    });
    drawer.appendChild(el('div', { class: 'steps' }, plan));
    drawer.style.display = 'block';
    scrim.style.display = 'block';
  }

  // ---- render -------------------------------------------------------------------------------

  function render() {
    app.textContent = '';
    app.appendChild(header());
    app.appendChild(statline());
    app.appendChild(modelCard());
    app.appendChild(controls());
    app.appendChild(boardTable());
    app.appendChild(liveTable());
    app.appendChild(el('p', { class: 'footnote', text: 'Data: ' + DATA.source + '. Watchlist floor ' + fmtUsd(DATA.floor_usd) + '. The watchlist is the floor, never the ceiling: ' + DATA.early_size + ' rows sit below it, because a protocol under the floor is no worse a subject. Implied value is this entry\'s own model, never a price and never a promise.' }));
    app.setAttribute('aria-busy', 'false');
    if (!scrim.isConnected) { app.appendChild(scrim); app.appendChild(drawer); }
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
})();
