"""Line Brewster's Tab up with a subtitle file.

Subtitle files stay on your machine: they are the film's dialogue and are not
committed to this repository (the root .gitignore excludes *.srt).

Usage, from the repository root:

  python tools/brewster/sync_ledger.py film.srt --money
      Print every subtitle line that talks about money, with its timestamp.
      Use this to find spends the ledger is missing and amounts said aloud.

  python tools/brewster/sync_ledger.py film.srt
      Dry run. For each ledger event with a "cue" phrase, find the subtitle
      containing that phrase nearest the event's current estimate and show
      the proposed time.

  python tools/brewster/sync_ledger.py film.srt --quotes
      For each ledger event, print the dialogue within 45 seconds of it.
      Copy a line you want into that event as
      "quote": {"text": "...", "who": "Monty", "t": "32:05"}. The page shows
      film quotes only from this field, so nothing is quoted unchecked.

  python tools/brewster/sync_ledger.py film.srt --write [--offset -2.5]
      Apply those times to site/brewster/data/ledger.json. --offset shifts
      every subtitle time (seconds) if your file is out of step with the cut.

Edit amounts, labels and cues by hand in ledger.json, then run the browser
checks at /brewster/tests/ to confirm the tab still ends at $30,000,000.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

LEDGER = Path(__file__).resolve().parents[2] / "site" / "brewster" / "data" / "ledger.json"
TIMING = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->")
MONEY = re.compile(r"\$\s?\d|\b(million|thousand|hundred grand|grand|dollars?|bucks|cash|check|pay|spend|spent|bill)\b", re.I)
TAGS = re.compile(r"<[^>]+>|\{[^}]+\}")
SEARCH_WINDOW = 20 * 60  # only accept a cue within 20 minutes of the current estimate


def parse_srt(path: Path, offset: float) -> list[tuple[float, str]]:
    text = path.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n")
    cues = []
    for block in re.split(r"\n\s*\n", text):
        lines = [line.strip() for line in block.strip().split("\n") if line.strip()]
        for i, line in enumerate(lines):
            match = TIMING.search(line)
            if match:
                h, m, s, ms = map(int, match.groups())
                words = TAGS.sub("", " ".join(lines[i + 1:])).strip()
                if words:
                    cues.append((max(0.0, h * 3600 + m * 60 + s + ms / 1000 + offset), words))
                break
    if not cues:
        sys.exit(f"No subtitle cues found in {path}")
    return sorted(cues)


def parse_time(value: str) -> int:
    total = 0
    for part in str(value).split(":"):
        total = total * 60 + int(part)
    return total


def fmt(seconds: float) -> str:
    whole = int(seconds)
    return f"{whole // 60}:{whole % 60:02d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("srt", type=Path)
    parser.add_argument("--money", action="store_true", help="list money-related dialogue and exit")
    parser.add_argument("--quotes", action="store_true", help="print dialogue near each event, to pick quotes from")
    parser.add_argument("--write", action="store_true", help="save matched times into ledger.json")
    parser.add_argument("--offset", type=float, default=0.0, help="seconds to add to every subtitle time")
    args = parser.parse_args()

    cues = parse_srt(args.srt, args.offset)
    print(f"{len(cues)} subtitle cues, last at {fmt(cues[-1][0])}")

    if args.money:
        for start, words in cues:
            if MONEY.search(words):
                print(f"{fmt(start):>7}  {words}")
        return

    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    if args.quotes:
        for event in ledger["events"]:
            at = parse_time(event["t"])
            print(f"\n{event['t']:>7}  {event['label']}")
            for start, words in cues:
                if abs(start - at) <= 45:
                    print(f"         {fmt(start):>7}  {words}")
        return

    matched = 0
    for event in ledger["events"]:
        cue = event.get("cue")
        if not cue:
            continue
        estimate = parse_time(event["t"])
        hits = [start for start, words in cues if cue.lower() in words.lower() and abs(start - estimate) <= SEARCH_WINDOW]
        if not hits:
            print(f"  --    {event['t']:>7}  {event['label']}: no subtitle containing '{cue}' near here")
            continue
        best = min(hits, key=lambda start: abs(start - estimate))
        matched += 1
        print(f"  ok    {event['t']:>7} -> {fmt(best):>7}  {event['label']}  ('{cue}')")
        if args.write:
            event["t"] = fmt(best)
            event["synced"] = True

    print(f"{matched} of {sum(1 for e in ledger['events'] if e.get('cue'))} cued events matched")
    if args.write:
        LEDGER.write_text(json.dumps(ledger, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {LEDGER}")
    else:
        print("Dry run. Add --write to save these times.")


if __name__ == "__main__":
    main()
