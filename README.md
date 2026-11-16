# djaykurtz.github.io

Source for my portfolio site at **https://djaykurtz.github.io/**.

The site is plain HTML and CSS in the `site/` folder, published by GitHub Pages.

Projects featured on the site:

- [COHORT](https://github.com/djaykurtz/COHORT)
- [ANS-CHOCO](https://github.com/djaykurtz/ANS-CHOCO)
- [Azure Local POC](https://github.com/djaykurtz/AZLOCAL-POC)

## Something Fun

Side projects live separately from the three professional showcases.
The cover page and sidebar link to
[Something Fun](https://djaykurtz.github.io/something-fun/).

Its first story is Leximotive: a terminal word-puzzle solver that grew into
a daily browser game. The page uses plain language and screenshots to explain
the original challenge and how the game works.

- Story: `site/something-fun/index.html`
- Play: [Leximotive](https://djaykurtz.github.io/leximotive/)
- Portable game files and word-list credits: `site/leximotive/`

The existing Pages workflow publishes the entire `site/` directory, including
both new paths. The game has no backend server or build step. Its own styles
and scripts are separate from the portfolio, and progress stays in the player's
browser. See `site/leximotive/README.md` for game details.

## Something Informative

The sidebar's "Away from work" section links to
[Something Informative](https://djaykurtz.github.io/something-informative/),
next to Something Fun: a short note on why Brewster's Tab was fun to build.

- Story: `site/something-informative/index.html`

### Brewster's Tab

- Page: [/brewster/](https://djaykurtz.github.io/brewster/)

A one-page calculator for *Brewster's Millions* (1985): enter a timestamp and
see how much of the $30 million Monty Brewster has spent by then, with a
ticker, a running total and a line chart. A "How the numbers work" section
shows the formula behind each estimate, a waterfall of where the money went,
and how wide each estimate's range is.

- Play: [Brewster's Tab](https://djaykurtz.github.io/brewster/)
- Page and ledger data: `site/brewster/` (see `site/brewster/README.md`)
- Subtitle sync tool: `tools/brewster/sync_ledger.py` (not published)
