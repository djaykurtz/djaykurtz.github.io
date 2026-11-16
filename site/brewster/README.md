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
| `kind` | `spend` (positive amount), `windfall` (negative: money came back) or `milestone` (zero) |
| `amount` | Dollars added to the tab |
| `label`, `detail` | What the page shows |
| `cue` | A word or phrase from the dialogue near that moment, used by the sync tool |

The running total must finish at exactly `budget`; the checks fail otherwise.
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
