"""Load transfer reports from a folder and turn them into a table + diagnosis."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev

from .models import TransferReport

_REPETITION = re.compile(r"-r\d+$")


def load_reports(folder: Path) -> list[TransferReport]:
    """Parses every *.json in `folder` (sorted by name) into a TransferReport."""
    reports: list[TransferReport] = []
    for path in sorted(folder.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        reports.append(TransferReport.model_validate(data).model_copy(update={"source": path.stem}))
    return reports


def clean(reports: list[TransferReport]) -> tuple[list[TransferReport], list[str]]:
    """Drops post-completion re-exports (fileBytes 0) and keeps one report per sender session."""
    kept: list[TransferReport] = []
    dropped: list[str] = []
    sessions: set[int] = set()
    for r in reports:
        if r.complete and r.file_bytes == 0:
            dropped.append(f"{r.source}: re-exportacao apos concluir (fileBytes=0, goodput=0)")
            continue
        if r.session_id is not None and r.session_id in sessions:
            dropped.append(f"{r.source}: sessao 0x{r.session_id:04x} repetida")
            continue
        if r.session_id is not None:
            sessions.add(r.session_id)
        kept.append(r)
    return kept, dropped


def _fmt(value: float | None, pattern: str) -> str:
    return "-" if value is None else format(value, pattern)


def _row(label: str, r: TransferReport) -> list[str]:
    return [
        label,
        r.device_family,
        f"v{r.sender.qr_version}" if r.sender else "v1*",
        str(r.block_len or "?"),
        str(r.codes_per_frame),
        _fmt(r.display_fps, ".1f"),
        f"{r.capture_fps:.1f}",
        _fmt(r.catch_rate and r.catch_rate * 100, ".0f"),
        f"{r.hit_rate * 100:.0f}",
        f"{r.overhead:.3f}",
        f"{r.goodput_kbs:.1f}",
        f"{r.payload_goodput_kbs:.1f}",
        _fmt(r.transition_window_ms, ".0f"),
        str(r.k),
        f"{r.total_seconds:.1f}",
        r.tag or "-",
    ]


_HEADERS = [
    "run", "aparelho", "QR", "B/cod", "cod", "fps tela", "fps capt", "catch%", "hit%",
    "overhead", "KB/s", "payload", "W ms", "K", "total s", "tag",
]


def _render(headers: list[str], rows: list[list[str]]) -> str:
    widths = [max(len(headers[c]), *(len(row[c]) for row in rows)) for c in range(len(headers))]

    def fmt(cells: list[str]) -> str:
        return " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells))

    return "\n".join([fmt(headers), "-+-".join("-" * w for w in widths), *(fmt(r) for r in rows)])


def table(reports: list[TransferReport]) -> str:
    """Renders an aligned ASCII table, one row per report (KB = 1024 B)."""
    return _render(_HEADERS, [_row(f"#{i + 1}", r) for i, r in enumerate(reports)])


def group_key(r: TransferReport) -> str:
    """Repetitions share a key: the ?tag= without its '-rN' suffix, else the configuration label."""
    return _REPETITION.sub("", r.tag) if r.tag else r.label


def groups(reports: list[TransferReport]) -> str:
    """Mean ± sd per configuration — the numbers that go into the TCC tables."""
    by_key: dict[str, list[TransferReport]] = defaultdict(list)
    for r in reports:
        if r.complete and not r.latency_dominated:
            by_key[group_key(r)].append(r)

    def spread(values: list[float]) -> str:
        if not values:
            return "-"
        return f"{mean(values):.1f}" + (f" ± {stdev(values):.1f}" if len(values) > 1 else "")

    rows = [
        [
            key,
            str(len(runs)),
            spread([r.goodput_kbs for r in runs]),
            spread([r.catch_rate * 100 for r in runs if r.catch_rate is not None]),
            spread([r.capture_fps for r in runs]),
            f"{mean(r.overhead for r in runs):.3f}",
        ]
        for key, runs in sorted(by_key.items())
    ]
    return _render(["configuracao", "n", "KB/s", "catch %", "fps capt", "overhead"], rows) if rows else ""


def diagnose(reports: list[TransferReport]) -> list[str]:
    """Heuristics that turn the numbers into next-step guidance (emissor -> captura -> fountain)."""
    notes: list[str] = []
    measurable = [r for r in reports if r.complete and not r.latency_dominated] or reports
    best = max(measurable, key=lambda r: r.goodput_kbs)
    notes.append(f"melhor: #{reports.index(best) + 1} {best.label} - {best.goodput_kbs:.1f} KB/s")
    for i, r in enumerate(reports):
        run = f"#{i + 1}"
        if r.latency_dominated:
            notes.append(
                f"{run}: K={r.k} - arquivo cabe em {r.k} quadro(s); o 'goodput' nao mede nada. "
                f"Use o tempo total (aquisicao + transferencia) = {r.total_seconds:.1f} s."
            )
            continue
        if r.sender and r.sender.stalls:
            notes.append(f"{run}: emissor travou {r.sender.stalls}x (aba oculta/minimizada) - refaca o run.")
        if r.acquisition_seconds and r.acquisition_seconds > 10:
            notes.append(
                f"{run}: aquisicao de {r.acquisition_seconds:.0f} s - operador; posicione o celular antes de "
                f"iniciar a camera."
            )
        if r.display_fps and r.capture_fps < 0.95 * r.display_fps:
            notes.append(
                f"{run}: captura limitada pelo receptor ({r.capture_fps:.1f} fps < {r.display_fps:.0f} exibidos): "
                f"teste ?decode=1280 ou um fps de tela menor."
            )
        if r.phase_locked and r.catch_rate is not None:
            notes.append(
                f"{run}: camera e tela na mesma taxa ({r.capture_fps:.1f} x {r.display_fps:.1f} fps) - "
                f"catch {r.catch_rate * 100:.0f}% depende da fase (bimodal): repita pelo menos 3x."
            )
        elif r.codes_per_frame > 1 and r.codes_per_capture < 0.6 * r.codes_per_frame:
            notes.append(
                f"{run}: cada captura leu {r.codes_per_capture:.1f} de {r.codes_per_frame} codigos - pouca "
                f"resolucao por codigo: celular na horizontal, mais perto, QR menos denso ou 2 codigos."
            )
        elif r.catch_rate is not None and r.catch_rate < 0.6:
            window = r.transition_window_ms
            notes.append(
                f"{run}: catch {r.catch_rate * 100:.0f}% - o receptor perdeu codigos exibidos"
                + (f" (janela de troca W~{window:.0f} ms)." if window is not None else ".")
            )
        elif r.catch_rate is None and r.hit_rate < 0.5:
            notes.append(
                f"{run}: hitRate {r.hit_rate * 100:.0f}% baixo - le ~{r.unique_qr_per_second:.0f} QR/s "
                f"mas captura {r.capture_fps:.0f} fps. Provavel straddling/foco."
            )
        if r.protocol_version and r.protocol_version >= 2 and r.overhead > 1.15:
            notes.append(
                f"{run}: overhead {r.overhead:.2f}x com eliminacao gaussiana (esperado ~1.05x) - "
                f"lado do fountain: confira framesRedundant={r.frames_redundant}."
            )
        elif not r.protocol_version and r.overhead > 1.3 and r.k < 100:
            notes.append(
                f"{run}: overhead {r.overhead:.2f}x - protocolo v1 (so peeling); o v2 decodifica perto de K."
            )
    return notes
