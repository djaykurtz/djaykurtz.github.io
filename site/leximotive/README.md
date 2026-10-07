# Leximotive

**The Daily Railword. Find your route home.**

A portable word railway: plain HTML, CSS and native JavaScript modules.
No packages, build step, account, backend or runtime Python.

## Preview

From the parent directory:

```powershell
python -B -m http.server 8787 --bind 127.0.0.1 --directory leximotive
```

Open `http://127.0.0.1:8787/`. Use HTTP rather than `file:`: modules, data
requests and module workers need a web origin. Use localhost for development
and HTTPS when hosting: Web Locks coordinate daily writes across tabs and
Web Crypto verifies each dictionary checksum.

## Publish on GitHub Pages

Copy this entire folder into the portfolio repository as `leximotive`.
It works at a domain root or a subdirectory such as
`https://djaykurtz.github.io/leximotive/`. Keep file names and capitalization
unchanged. All game assets are relative. There are no external fonts, CDNs,
game APIs or analytics; credit links open only when clicked.

## Gameplay

- **Leaving Today:** preview Local (4-letter words), Regional (5), or Long-haul
  (6). The first accepted move or successful hint request books one daily
  ticket. Confirmed Give up also books the chosen journey. Invalid guesses,
  cancelled Give up, and typing do not lock a choice.
- Four- and five-letter starts have **zero correct-position matches** with
  home. Six-letter starts have at most one. Elsewhere matches remain possible.
- Tap a large tile, type one ASCII A-Z letter, then confirm with Enter or
  Make move. The original glyph fades to 20% while editing. Typing another
  single letter replaces the preview; multi-letter paste is rejected.
- Every accepted word changes exactly one letter and belongs to the standard
  SCOWL American-English vocabulary, limited to lengths 4, 5 and 6. Normal
  vocabulary, inflections and established loanwords such as HONE and TACO are
  admitted; this is not an "only very common words" list. Focused exceptions
  exclude the STANE family, RAGOUT, THEE, THOU and THINE from moves, hints and minimum routes alike.
  Invalid attempts are free.
- The full track stays visible as chronological word-stations, including
  revisits. The engine travels to accepted stops; only the changed tile flips.
  Stops stay in one **vertical column at every screen size**. On desktop the
  track is left, while the logo, date, journey choices, statistics and hints
  occupy the right station desk. Phones stack the desk and track without
  wrapping the word progression into horizontal rows. Reduced motion is
  respected in both layouts.
- A solid underline marks a letter in its correct home position. Dots mark
  a match elsewhere. Dark unmarked tiles have no remaining match. The local
  target, prompts and acceptance/errors stay at the current station. The
  `?` guide opens the marking key by touch or keyboard; hover titles provide
  quick descriptions. Repeated explanations are not permanently on the board.
  Marks describe the accepted word, not a pending preview or route distance.
  Matching letters are not locked.
- Each puzzle has an optional **Coaling Station**, initially shown as a clue
  rather than a word. Its first landing transform is free once per daily ticket;
  revisiting it does not create another credit. It is never mandatory.
  The count shows the station credit; its description and closing results
  explain the actual transforms separately.
- **Two requested waypoint tickets** per daily ticket. A shortest route from
  the current word is chosen to favour unvisited stops and familiar vocabulary;
  its least-common unknown intermediate word becomes an oil-smudged destination.
  One letter is hidden in four-/five-letter words, two in six-letter words.
  No intervening moves are revealed. Necessary revisits are explained.
  A small native dialog fades in; explicitly closing it tucks the ticket into
  a bottom-right pocket in 300 ms. Reduced motion skips the movement.
  Pocketed tickets can be reopened for free, including after a refresh or reset.
  Already visited/revealed waypoints are not sold again. If none remain, the
  request explains why without consuming a hint or booking a preview.
- Restarts preserve the daily choice, hints already used, known stops and a
  claimed station credit. A restart clears the current track and its credited
  landing marker, increases the restart counter, and does not replenish the
  daily free stop. An unclaimed free stop remains available. Start over uses a rewind icon
  and does nothing before an accepted transform, including hint-only sessions
  and unconfirmed previews. Refresh is not a restart.
- **Give up ends that journey for the day.** Confirmation reveals a minimum
  route in the closing splash. Moves, hints, and restarts then stay disabled,
  including after refresh; there are no more attempts on that ticket.
- The opening splash is centred over the full game panel, including both
  the track and station desk, rather than the empty centre of the page.
  It stays clamped to the visible screen when resized.
  It features the full logo and quick rules once per tab/day;
  click the compact logo to reopen it. Completion displays **You Made it
  Home!**, followed by a closing splash explaining moves, par, station credit,
  hints and restarts, with an optimal route. Results can be reopened from the
  finished track. Numerical point scoring remains deferred.
- A pocketed ticket belongs to the stop where it was found. It is not a
  sequence of moves. Saved hint usage includes earlier restarted runs.
- Par is the true minimum without station credit, using the same modern-English
  vocabulary as gameplay. Every puzzle has a verified minimum witness
  with its Coaling Station on that path; the credited route can beat par.
- **Point scoring is deferred.** The current edition records moves, par,
  restarts, free stops and hint usage.

New departures arrive worldwide at **8 AM America/Los_Angeles**, following
PDT/PST automatically. A journey in progress remains intact at rollover;
the new-day notice opens a fresh daily choice. The demo has **182 preselected
days**, each offering Local, Regional and Long-haul: **546 puzzles** altogether.
It covers October 6, 2026 through April 5, 2027, then repeats the same schedule.
No start/goal pair repeats within a length during those six months.
Everything is prepared offline and shipped in `data\puzzles.json`; the browser
does not generate new daily puzzles or look up words online.

## Persistence and the new timetable

One atomic browser-storage ticket stores the daily length, history, restart
count and requested hints. Other open tabs restore changes to that ticket.
Storage failures are reported and allow in-memory play. Corrupt tickets are
not overwritten until an explicit Replace invalid save (or a confirmed
restart after actual moves). Repairing an untouched save does not book a
journey or count as a restart. The ticket format is version 3 and preserves
known stops and the daily station claim across restarts. Its optional `gaveUp`
field defaults to false when absent.

The modern-English vocabulary and six-month bank change routes and pars, so
the edition is `railword-v5`, with word policy `scowl-american-60-v2`. Previous
`leximotive:railword-v2:`, `leximotive:railword-v3:` and prototype saves remain untouched
but do not load against the new puzzles and dictionaries. The preferred-length
setting is retained.
Storage belongs to the browser origin; a different domain or port has its own
records. This is a casual client-side game, not a tamper-proof competition.

The unchanged pre-splash game is preserved locally as Git tag `v0.8` and
the adjacent `leximotive-v0.8.zip`. Git is development-only; neither `.git`
nor `.gitattributes` belongs in the published bundle.

## Structure

`js\engine.js` holds rules, Pacific calendar selection, hint quota/target and
free-stop accounting. `js\graph.js` indexes wildcard neighbors, computes reverse
BFS distances and exact shortest-route counts with BigInt, and caches the two
active targets. `js\graph-worker.js` performs the graph work off the UI thread;
`js\route-client.js` manages requests and cancellation.

`js\storage.js` validates daily-ticket state. `js\app.js` coordinates booking,
native inputs, requested hints and dialogs. Daily changes are serialized with
Web Locks and checked against the latest saved ticket before a write;
stale actions reload the shared journey rather than overwrite it.
`js\journey.js` renders the track
and manages interruptible engine motion and geometry.

Only the selected dictionary initially downloads. A mode change replaces its
worker. The ticket, locomotive and styling are original work inspired by
railway waiting rooms: cream paper, dark iron, brass, walnut and deep green.
Design-reference photographs are not shipped.

## Preparing the timetable

The parent project's Python solver and source datasets are development-only:

```powershell
python -B scripts\build_leximotive_data.py
python -B scripts\build_leximotive_data.py --check
```

The source is Kevin Atkinson's English Speller Database / SCOWL, release
`2026.02.25`, **American English, standard size 60, normal variants 0-1**.
This is the project's vetted standard spell-checking level, not its larger
Scrabble-oriented levels. The prepared source is
`data\scowl-american-60-2026.02.25.txt`; revisions, filters and checksum are in
`data\scowl-american-60.source.json`. Generation needs no network access.

The official `libscowl` filters exclude abbreviations, nonwords/Roman numerals,
word parts, prefixes/suffixes, contractions, marked nonstandard forms and the
strongest offensive labels. We then retain lowercase ASCII words of exactly
4-6 letters, excluding capitalized names and accented spellings rather than
transliterating them. `scripts\leximotive_exclusions.txt` contains the small
game-specific exception list, including RAGOUT and archaic/dialect examples.
This standard list is a reasonable broad vocabulary, not a guarantee that
every player knows every entry or that every borderline word is uncontroversial.
The terminal assistant and its original dictionaries remain unchanged.

The game contains **2,626 four-letter words, 5,137 five-letter words and 8,336
six-letter words**. HONE, HONED, HONES, HONING, TACO and TACOS are included.
Frequency is not an admission rule.

The generator uses familiar endpoint pools, calculates exact distances against
this shared vocabulary, checks initial matches, selects an interior station with
a prepared clue, and validates its discounted route. Frequency breaks ties only
between legal shortest routes. All 546 puzzles are verified before writing.
`--check` requires packaged vocabulary to equal the source-minus-exclusions
policy, checking its checksums and every par and station witness.

If published puzzles change, words are removed, or additions change published
pars, bump the catalog and generator edition together so saved tickets never
attach to incompatible content. Append-only vocabulary corrections may retain
the edition only after verifying that all published puzzles and pars are
unchanged, preserving existing daily tickets.
The published timetable and bundled commonness ranks are base64-encoded,
and published puzzle records contain no solution paths. This deters casual
source-view spoilers, not determined inspection: a static game's data can
always be decoded and its graph solved. Full solution paths are not returned
to the interface until the player finishes or gives up.

## Checks

Serve this folder and open `tests/index.html` for native-module checks:
rules, input, duplicate-letter feedback, Pacific DST cutoffs, requested hints,
free-stop accounting, persistence, graph counts, all 546 pars and station routes,
initial match limits, dictionary checksums, dialect rejection and the real
worker. No Node.js is required.

The optional parent `scripts\check_leximotive_browser.py` checks real Edge
desktop/touch gameplay, daily locking, cross-tab restoration, manual hints,
restarts, motion, corrupt-save recovery, vertical track geometry, sidebar and
phone fit, old-edition isolation, and nested hosting. Python Playwright
and Edge are development tools, not published-site dependencies.

`scripts\check_leximotive_edges.py` adds intro geometry and exact-copy checks,
ticket readability/reopening/motion, daily station claims, synchronized booking
races, stale-tab Give up protection, rollover pinning, failed-module retry,
same-count corrupted dictionary rejection, and encoded/no-solution timetable checks.

## Sources

Game vocabulary: [English Speller Database / SCOWL](https://wordlist.aspell.net/),
release `2026.02.25`, default American-English size 60 with the filters above.
Copyright 2000-2026 Kevin Atkinson, distributed under the permission notice in
`data\LICENSE-scowl.txt`. The source is pinned to database revision
`71d7dd07676edb60ade43552e10b41314b7e9287` and tool revision
`7e99edab8e32f9f9ea2b15f249ca8d4d67237410`. This game is a filtered derivative;
it does not redistribute Merriam-Webster entries.

Puzzle preparation and bundled hint ranks use [Hermit Dave's FrequencyWords](https://github.com/hermitdave/FrequencyWords)
/ English OpenSubtitles2018, revision
`072bbed282316a23651aa7068c7173aa7898cf80`, under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The Firebox panel preserves this credit; no third-party frequency service is
contacted during gameplay. The ticket smudges are original CSS, with the
[user-provided Vecteezy brush-stroke collection](https://www.vecteezy.com/vector-art/75662809-hand-painted-brush-strokes-collection)
credited as a visual reference, not imported artwork. No Hoyle or Poople artwork
or application code is copied.
