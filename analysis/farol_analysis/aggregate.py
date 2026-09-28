"""Load transfer reports from a folder and turn them into a table + diagnosis."""

from __future__ import annotations

import json
from pathlib import Path

from .models import TransferReport


def load_reports(folder: Path) -> list[TransferReport]:
    """Parses every *.json in `folder` (sorted by name) into a TransferReport."""
    reports: list[TransferReport] = []
    for path in sorted(folder.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        reports.append(TransferReport.model_validate(data))
    return reports


def _row(label: str, r: TransferReport) -> list[str]:
    return [
        label,
        f"{r.goodput_kbs:.1f}",
        f"{r.hit_rate * 100:.0f}%",
        f"{r.capture_fps:.0f}",
        f"{r.unique_qr_per_second:.1f}",
        f"{r.overhead:.2f}",
        str(r.bytes_per_frame) if r.bytes_per_frame else "?",
        str(r.k),
        f"{r.file_bytes / 1024:.0f}",
        "ok" if r.complete else f"{r.progress * 100:.0f}%",
    ]


_HEADERS = ["run", "KB/s", "hit", "capFps", "QR/s", "over", "B/frame", "K", "arq(KB)", "status"]


def table(reports: list[TransferReport]) -> str:
    """Renders an aligned ASCII table, one row per report."""
    rows = [_row(f"#{i + 1}", r) for i, r in enumerate(reports)]
    widths = [max(len(_HEADERS[c]), *(len(row[c]) for row in rows)) for c in range(len(_HEADERS))]

    def fmt(cells: list[str]) -> str:
        return " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    sep = "-+-".join("-" * w for w in widths)
    return "\n".join([fmt(_HEADERS), sep, *(fmt(r) for r in rows)])


def diagnose(reports: list[TransferReport]) -> list[str]:
    """Heuristics that turn the numbers into next-step guidance."""
    notes: list[str] = []
    best = max(reports, key=lambda r: r.goodput_kbs)
    notes.append(
        f"melhor: #{reports.index(best) + 1} - {best.goodput_kbs:.1f} KB/s "
        f"(hit {best.hit_rate * 100:.0f}%, {best.bytes_per_frame or '?'} B/frame)"
    )
    for i, r in enumerate(reports):
        if r.hit_rate < 0.5:
            notes.append(
                f"#{i + 1}: hitRate {r.hit_rate * 100:.0f}% baixo - le ~{r.unique_qr_per_second:.0f} QR/s "
                f"mas captura {r.capture_fps:.0f} fps. Provavel straddling/foco: "
                f"teste fps de tela ~{r.capture_fps / 2:.0f} ou densidade menor."
            )
        if r.overhead > 1.3 and r.k < 100:
            notes.append(
                f"#{i + 1}: overhead {r.overhead:.2f}x - esperado para K pequeno ({r.k}); "
                f"diminui com arquivos maiores."
            )
        if r.capture_fps < 15:
            notes.append(f"#{i + 1}: captureFps {r.capture_fps:.0f} baixo - CPU/camera podem ser o limite.")
    return notes
