# YGO Set Finder

Paste a Yu-Gi-Oh! decklist, get the answer to the question YGOPRODeck does not
answer: **which sets do I buy, and in what order?**

Instead of looking up every card individually to see where it was printed, and then
checking a second site to see whether it is about to be reprinted, drop the whole
deck in at once:

- **Set coverage** — every set ranked by how many of your missing cards it contains,
  with the rarity each card is printed at.
- **Buying plan** — a purchase order ("buy this, then that") that stops recommending
  a set once an earlier purchase already covered its cards. Sticks to products with
  fixed contents, so it never claims a booster "gets" you a Secret Rare.
- **Reprint radar** — cards in your deck that are in an announced, unreleased set,
  with a *worth waiting for* warning on the expensive ones.
- **Collection** — mark what you already own (or import a `.ydk` of it) and every
  number above recalculates for the cards actually missing.
- **Budget** — deck cost at Cardmarket prices, and where the money goes.

Decks live in the URL, so any analysis is a shareable link.

## Getting started

```bash
npm install
npm run fetch-data   # downloads the card database from YGOPRODeck (needs internet)
npm run dev
```

`fetch-data` makes exactly two API calls and writes `public/data/db.json`. That file
is gitignored: it is regenerated weekly by CI and deployed straight to GitHub Pages,
so the repo does not grow by several megabytes per refresh.

```bash
npm test         # unit tests, no network needed
npm run typecheck
npm run build
```

## Getting a deck in

Anything you paste is auto-detected:

| Input | Where to get it |
| --- | --- |
| `ydke://…` | YGOPRODeck deck page → **Copy YDKE URL** (also EDOPro, Master Duel tools) |
| `.ydk` file | YGOPRODeck deck page → **Download YDK**. Drag the file onto the box |
| Plain text | `3x Ash Blossom`, `3 Ash Blossom`, `Ash Blossom x3`, `Ash Blossom (3)` |

Alt-artwork passcodes resolve to the same card, so `.ydk` files exported from
simulators do not come back with "unknown card".

## How it works

There is no server. A build step turns the YGOPRODeck dump into a compact index
(positional arrays plus string tables, a few MB instead of ~100), the browser loads
it once and does all the ranking locally. No rate limits, no per-user API traffic.

- `src/lib/setFinder.ts` — coverage per set, the core calculation
- `src/lib/buyPlan.ts` — greedy set cover, turned into a purchase order
- `src/lib/reprints.ts` — future release dates are upcoming reprints
- `src/lib/setClassification.ts` — guaranteed contents vs. random pulls
- `src/lib/import/` — the three decklist formats
- `scripts/fetch-data.ts` — the once-a-week data pull

### Guaranteed vs. random

A Structure Deck has a fixed list: buy it, own the cards. A booster does not. The app
badges every set accordingly and the buying plan defaults to fixed-content products,
because a plan built on booster pulls is not a plan. Set classification is a
heuristic on the set code prefix — see `OVERRIDES` in `setClassification.ts` to
correct a specific set.

### Upcoming reprints without a second website

YGOPRODeck lists announced sets with a release date in the future. Any printing whose
set is dated later than today *is* an upcoming reprint, which is where the radar
comes from — no scraping.

## Limitations

- **Prices are approximations.** YGOPRODeck ships one Cardmarket price per card
  (roughly the cheapest available printing), not a price per rarity, and it is only
  as fresh as the last data refresh. Treat totals as an estimate, not a quote.
- **Set prices are not available.** The app reports the singles value a set covers,
  not what the sealed product costs — that number is not in the API.
- **No `ygoprodeck.com/deck/…` URL import.** There is no CORS-accessible endpoint for
  it, and adding a server just for that is not worth it. Use **Copy YDKE URL**.
- **Card images are not shown.** YGOPRODeck asks that images be self-hosted rather
  than hotlinked, and the deck view does not need them.

Card data from [YGOPRODeck](https://ygoprodeck.com/api-guide/). Not affiliated with
Konami.
