# Brewster's Tab

Enter a timestamp from *Brewster's Millions* (1985) and see how much of the
$30,000,000 Monty Brewster has spent by that point. Plain HTML, CSS and native
JavaScript modules. No packages, build step or backend.

## Preview

From the repository root:

```sh
python -m http.server 8765 --directory site
```

Open `http://127.0.0.1:8765/brewster/`. Use HTTP rather than `file:`, because
the page fetches its ledger. Browser checks run at `/brewster/tests/`.

Link straight to a moment with a hash, e.g. `/brewster/#t=54:10`.

## The ledger

Everything the page shows comes from `data/ledger.json`. Each event has:

| Field | Meaning |
|---|---|
| `t` | Timestamp as `m:ss` in total minutes (e.g. `101:30`) |
| `kind` | `spend`, `windfall` (money came back, so negative) or `milestone` (no money) |
| `category` | Key into `categories`; groups the waterfall chart |
| `calc` | One-off costs: lines of `[description, quantity, unit price]` |
| `daily` | Running costs: lines of `[description, quantity, cost per day]` |
| `until` | When daily costs stop (defaults to the end of `clock`) |
| `range` | `[low, high]` guess around the amount |
| `plug` | `true` on the one entry that balances the books (see below) |
| `basis` | Set to `"stated"` once a price is confirmed from the dialogue |
| `label`, `detail` | What the page shows |
| `cue` | A word or phrase from the dialogue near that moment, used by the sync tool |

### How the estimates are built

1. The will fixes the total: the tab ends at exactly `budget`.
2. Each spend is priced with a formula in `calc`, in 1985 dollars. The unit
   prices are unsourced assumptions.
3. Running costs (salaries, rent, the suite, cars, guards, campaign staff) go
   in `daily`. They're charged by the day from the event until `until`.
   `clock` spreads the story's 30 days evenly over a stretch of the film, so
   a day is about 2.6 minutes of screen time, and the day count for each
   entry is rounded from that. Between events the tab rises in a straight line.
4. Money that comes back is a `windfall` with a negative amount.
5. The plug entry has no `calc`. Its amount is `budget` minus everything else,
   and its range is the budget minus the sum of all highs, up to the budget
   minus the sum of all lows. If the itemized estimates ever exceed the
   budget, the checks fail.

The page computes the summary tiles, the waterfall and the range chart from
this file, so editing a price updates every chart and sentence that uses it.
While `status` is `"draft"` the page shows `statusNote` as a banner. Set it to
`"synced"` once times and amounts have been checked.

## Syncing with subtitles

The first draft was estimated from the story, not from timed dialogue. To
tighten it, get an `.srt` that matches your copy of the film and run:

```sh
python tools/brewster/sync_ledger.py film.srt --money   # money talk, with times
python tools/brewster/sync_ledger.py film.srt           # proposed times (dry run)
python tools/brewster/sync_ledger.py film.srt --write   # apply them
```

Subtitle files are the film's dialogue, so they are git-ignored and never
published. Only the ledger's own short descriptions are on the site.
