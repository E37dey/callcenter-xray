"""Transcribe a folder of Hebrew call recordings locally, without sending audio anywhere.

Uses faster-whisper with an ivrit.ai Hebrew model. Writes one .txt per recording,
ready to upload in the app ("העלאת קבצים").

    pip install faster-whisper
    python tools/transcribe.py recordings/ --out transcripts/
    python tools/transcribe.py recordings/ --model large-v3 --device cuda   # any faster-whisper model

The first run downloads the model (a few GB for large models). On CPU a large model
is slow; use --model small for a quick look, or a GPU for real volumes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

AUDIO = {".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac", ".aac"}
DEFAULT_MODEL = "ivrit-ai/whisper-large-v3-turbo-ct2"


def fmt(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def transcribe_file(model, path: Path, timestamps: bool) -> str:
    segments, _info = model.transcribe(str(path), language="he", vad_filter=True, beam_size=5)
    lines = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(f"[{fmt(seg.start)}] {text}" if timestamps else text)
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", type=Path, help="folder with audio files")
    ap.add_argument("--out", type=Path, default=None, help="output folder (default: next to the audio)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--timestamps", action="store_true", help="prefix each line with [mm:ss]")
    args = ap.parse_args(argv)

    files = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in AUDIO) if args.folder.is_dir() else []
    if not files:
        print(f"No audio files found in {args.folder}", file=sys.stderr)
        return 2

    from faster_whisper import WhisperModel  # imported late so --help works without it

    compute = "float16" if args.device == "cuda" else "int8"
    model = WhisperModel(args.model, device=args.device, compute_type=compute)
    out_dir = args.out or args.folder
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, f in enumerate(files, 1):
        print(f"[{i}/{len(files)}] {f.name}…", flush=True)
        text = transcribe_file(model, f, args.timestamps)
        (out_dir / (f.stem + ".txt")).write_text(text + "\n", encoding="utf-8")
    print(f"Done. {len(files)} transcripts in {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
