"""Accuracy test for call-reason classification.

Runs the same classification the web app runs (section 4, "מבחן דיוק") against a
labeled CSV and prints overall accuracy, per-label recall/precision and the mistakes.

Usage:
    pip install anthropic
    export ANTHROPIC_API_KEY=sk-ant-...
    python eval/run_eval.py                       # built-in demo set
    python eval/run_eval.py my_calls.csv --redact # your own set, PII masked first

CSV format: two columns, text,label (a header row is optional).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

DEFAULT_MODEL = "claude-sonnet-5"
HERE = Path(__file__).resolve().parent


# ---------- PII masking (same rules as the web app) ----------

def is_israeli_id(s: str) -> bool:
    d = re.sub(r"\D", "", s)
    if not 8 <= len(d) <= 9:
        return False
    d = d.zfill(9)
    total = 0
    for i, ch in enumerate(d):
        v = int(ch) * (i % 2 + 1)
        total += v - 9 if v > 9 else v
    return total % 10 == 0


def luhn(s: str) -> bool:
    d = re.sub(r"\D", "", s)
    if not 13 <= len(d) <= 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(d)):
        v = int(ch)
        if i % 2:
            v *= 2
            if v > 9:
                v -= 9
        total += v
    return total % 10 == 0


RULES = [
    ("מייל", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), None),
    ("חשבון בנק", re.compile(r"\bIL\d{2}(?:[ -]?\d{4}){4}[ -]?\d{3}\b", re.I), None),
    ("כרטיס אשראי", re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), luhn),
    ("ת.ז", re.compile(r"(?<!\d)\d{8,9}(?!\d)"), is_israeli_id),
    ("טלפון", re.compile(r"(?<!\d)(?:\+972[- ]?|0)(?:5\d|[23489]|7\d)[- ]?\d{3}[- ]?\d{4}(?!\d)"), None),
]
NAME_RE = re.compile(r"(קוראים לי|שמי|השם שלי|שם מלא:?|מדבר(?:ת)? עם)\s+([א-ת][א-ת'\"׳-]+(?:\s[א-ת][א-ת'\"׳-]+)?)")


def redact(text: str, counts: Counter) -> str:
    for label, rx, check in RULES:
        def sub(m, label=label, check=check):
            if check and not check(m.group(0)):
                return m.group(0)
            counts[label] += 1
            return f"[{label}-{counts[label]}]"
        text = rx.sub(sub, text)

    def sub_name(m):
        counts["שם"] += 1
        return m.group(0).replace(m.group(2), f"[שם-{counts['שם']}]")

    return NAME_RE.sub(sub_name, text)


# ---------- data ----------

def load_rows(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for i, rec in enumerate(csv.reader(f)):
            if len(rec) < 2:
                continue
            text, label = ",".join(rec[:-1]).strip(), rec[-1].strip()
            if i == 0 and label.lower() in {"label", "תווית", "סיווג"}:
                continue
            if text and label:
                rows.append({"text": text, "label": label})
    return rows


def build_prompt(rows: list[dict], labels: list[str]) -> str:
    cats = ", ".join(f'"{l}"' for l in labels)
    calls = "\n".join(f"{i + 1}. {r['text']}" for i, r in enumerate(rows))
    return (
        f"סווג כל שיחה במוקד שירות לאחת מהקטגוריות הבאות בלבד: {cats}.\n"
        'החזר JSON בלבד: מערך של {"id":מספר,"label":"קטגוריה"} לכל שיחה, באותו סדר.\n\n'
        f"השיחות:\n{calls}"
    )


def parse_json_loose(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass
    start = min([i for i in (text.find("["), text.find("{")) if i >= 0], default=-1)
    end = max(text.rfind("]"), text.rfind("}"))
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])
    raise ValueError("model reply held no JSON")


def classify(prompt: str, model: str, client=None) -> dict[int, str]:
    if client is None:
        import anthropic  # imported here so --help works without the package
        client = anthropic.Anthropic()
    msg = client.messages.create(model=model, max_tokens=4000, messages=[{"role": "user", "content": prompt}])
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    out = {}
    for item in parse_json_loose(text):
        if isinstance(item, dict) and "id" in item:
            out[int(item["id"])] = str(item.get("label", "")).strip()
    return out


def report(rows: list[dict], preds: dict[int, str]) -> float:
    labels = sorted({r["label"] for r in rows})
    for i, r in enumerate(rows):
        r["pred"] = preds.get(i + 1, "—")
        r["ok"] = r["pred"] == r["label"]
    ok = sum(r["ok"] for r in rows)
    acc = ok / len(rows)
    print(f"\nAccuracy: {ok}/{len(rows)} = {acc:.0%}\n")
    print(f"{'label':<16}{'n':>4}{'recall':>9}{'precision':>11}")
    for l in labels:
        n = sum(r["label"] == l for r in rows)
        tp = sum(r["label"] == l and r["ok"] for r in rows)
        pn = sum(r["pred"] == l for r in rows)
        print(f"{l:<16}{n:>4}{(tp / n if n else 0):>9.0%}{(tp / pn if pn else 0):>11.0%}")
    wrong = [r for r in rows if not r["ok"]]
    if wrong:
        print("\nMistakes:")
        for r in wrong:
            print(f"- expected {r['label']!r}, got {r['pred']!r}: {r['text']}")
    return acc


def main(argv=None, client=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?", default=str(HERE / "dataset.csv"))
    ap.add_argument("--model", default=os.environ.get("XRAY_MODEL", DEFAULT_MODEL))
    ap.add_argument("--redact", action="store_true", help="mask ID numbers, phones, cards, emails and names before sending")
    args = ap.parse_args(argv)

    rows = load_rows(Path(args.csv))
    if len(rows) < 3:
        print("Need at least 3 labeled rows.", file=sys.stderr)
        return 2
    labels = sorted({r["label"] for r in rows})
    sent = rows
    if args.redact:
        counts: Counter = Counter()
        sent = [{"text": redact(r["text"], counts), "label": r["label"]} for r in rows]
        print("Masked:", dict(counts) or "nothing found")

    print(f"Classifying {len(rows)} calls into {len(labels)} labels with {args.model}…")
    preds = classify(build_prompt(sent, labels), args.model, client=client)
    report(rows, preds)
    return 0


if __name__ == "__main__":
    sys.exit(main())
