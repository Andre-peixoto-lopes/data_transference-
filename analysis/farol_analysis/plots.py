"""TCC figures from the transfer reports (and the fountain simulation)."""

from __future__ import annotations

from pathlib import Path
from statistics import median

import matplotlib

matplotlib.use("Agg")  # headless: write PNGs without a display

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

from .fountain_sim import SOLITON_ML, V1, V2, SimRow  # noqa: E402
from .models import TransferReport  # noqa: E402

COLORS = {"Android": "#2e9e5b", "iPhone": "#2f81f7", "?": "#8b949e"}
GRAY = "#8b949e"
CHANNEL_LOSS = "#d0d7de"
FOUNTAIN_LOSS = "#f0883e"

plt.rcParams.update(
    {
        "figure.dpi": 110,
        "savefig.dpi": 300,
        "savefig.bbox": "tight",
        "font.size": 10,
        "axes.titlesize": 11,
        "axes.titleweight": "bold",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.alpha": 0.3,
        "legend.frameon": False,
    }
)


def _save(fig: plt.Figure, out_dir: Path, name: str) -> Path:
    path = out_dir / name
    fig.savefig(path)
    plt.close(fig)
    return path


def _tag(reports: list[TransferReport], r: TransferReport) -> str:
    return f"#{reports.index(r) + 1} {r.label}"


def _measurable(reports: list[TransferReport]) -> list[TransferReport]:
    return [r for r in reports if r.complete and not r.latency_dominated]


def _device_legend(ax: plt.Axes, families: set[str], extra: list[Patch] | None = None) -> None:
    handles = [Patch(color=COLORS[f], label=f) for f in sorted(families)] + (extra or [])
    ax.legend(handles=handles, loc="lower right")


def fig_goodput(reports: list[TransferReport], out_dir: Path) -> Path | None:
    runs = sorted(_measurable(reports), key=lambda r: r.goodput_kbs)
    if not runs:
        return None
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(runs) + 1.5))
    bars = ax.barh(
        [_tag(reports, r) for r in runs],
        [r.goodput_kbs for r in runs],
        color=[COLORS[r.device_family] if r.sender else GRAY for r in runs],
    )
    for bar, r in zip(bars, runs):
        if not r.sender:
            bar.set_hatch("//")
    ax.bar_label(bars, fmt="%.1f", padding=3)
    ax.set_xlabel("goodput (KB/s; 1 KB = 1024 B)")
    ax.set_title("Goodput por transferência")
    ax.grid(axis="y", visible=False)
    _device_legend(ax, {r.device_family for r in runs if r.sender}, [Patch(facecolor=GRAY, hatch="//", label="v1 (baseline)")])
    return _save(fig, out_dir, "01_goodput_por_transferencia.png")


def fig_breakdown(reports: list[TransferReport], out_dir: Path) -> Path | None:
    runs = sorted(
        (r for r in _measurable(reports) if r.gross_kbs and r.catch_rate is not None),
        key=lambda r: r.gross_kbs or 0,
    )
    if not runs:
        return None
    fig, ax = plt.subplots(figsize=(8.5, 0.5 * len(runs) + 1.6))
    labels = [_tag(reports, r) for r in runs]
    useful = [r.model_goodput_kbs or 0 for r in runs]
    caught = [(r.gross_kbs or 0) * (r.catch_rate or 0) for r in runs]
    fountain = [c - u for c, u in zip(caught, useful)]
    channel = [(r.gross_kbs or 0) - c for r, c in zip(runs, caught)]
    ax.barh(labels, useful, color=[COLORS[r.device_family] for r in runs])
    ax.barh(labels, fountain, left=useful, color=FOUNTAIN_LOSS)
    ax.barh(labels, channel, left=caught, color=CHANNEL_LOSS)
    ax.scatter([r.payload_goodput_kbs for r in runs], labels, marker="D", color="black", zorder=3, s=18)
    for label, r in zip(labels, runs):
        ax.annotate(f"catch {r.catch_rate * 100:.0f}%", (r.gross_kbs or 0, label), xytext=(4, -3), textcoords="offset points", fontsize=8)
    ax.set_xlabel("KB/s de payload (fountain)")
    ax.set_title("Onde a vazão se perde: canal óptico × fountain")
    ax.grid(axis="y", visible=False)
    ax.legend(
        handles=[
            *(Patch(color=COLORS[f], label=f"útil — {f}") for f in sorted({r.device_family for r in runs})),
            Patch(color=FOUNTAIN_LOSS, label="perdido no fountain (overhead)"),
            Patch(color=CHANNEL_LOSS, label="perdido no canal (1 − catch)"),
            plt.Line2D([], [], marker="D", color="black", linestyle="", label="medido"),
        ],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.16),
        ncol=3,
        fontsize=8,
    )
    return _save(fig, out_dir, "02_decomposicao_da_vazao.png")


def _catch_model(window_ms: float, capture_fps: float, fps: list[float]) -> list[float]:
    """Asynchronous capture: a code is caught when a capture lands in its (T_d - W) clean slice."""
    return [min(1.0, max(0.0, (1000 / f - window_ms) * capture_fps / 1000)) * 100 for f in fps]


def fig_catch_vs_fps(reports: list[TransferReport], out_dir: Path) -> Path | None:
    runs = [r for r in _measurable(reports) if r.display_fps and r.catch_rate is not None and r.codes_per_frame == 1]
    if not runs:
        return None
    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    grid = [10 + i * 0.5 for i in range(101)]
    for family in sorted({r.device_family for r in runs}):
        mine = [r for r in runs if r.device_family == family]
        windows = [w for r in mine if (w := r.transition_window_ms) is not None]
        if windows:
            window, capture = median(windows), median(r.capture_fps for r in mine if not r.phase_locked)
            ax.plot(
                grid,
                _catch_model(window, capture, grid),
                linestyle="--",
                color=COLORS[family],
                alpha=0.7,
                label=f"{family}: modelo (W≈{window:.0f} ms, captura {capture:.0f} fps)",
            )
        placed: list[tuple[float, float]] = []
        for r in mine:
            x, y = r.display_fps or 0, (r.catch_rate or 0) * 100
            ax.scatter(x, y, color=COLORS[family], marker="*" if r.phase_locked else "o", s=160 if r.phase_locked else 50, zorder=3)
            crowd = sum(1 for px, py in placed if abs(px - x) < 1.5 and abs(py - y) < 5)
            placed.append((x, y))
            note = f"#{reports.index(r) + 1}" + (f" v{r.sender.qr_version}" if r.sender else "")
            if r.phase_locked:
                note += " (fase travada)"
            ax.annotate(note, (x, y), xytext=(7, -3 - 11 * crowd), textcoords="offset points", fontsize=8)
    ax.set_xlim(10, 60)
    ax.set_ylim(0, 105)
    ax.set_xlabel("fps de exibição (códigos trocados por segundo)")
    ax.set_ylabel("catch rate (% dos códigos exibidos lidos)")
    ax.set_title("Catch rate × fps de exibição (1 código por quadro)")
    ax.legend(loc="lower left", fontsize=8)
    return _save(fig, out_dir, "03_catch_vs_fps.png")


def fig_capture(reports: list[TransferReport], out_dir: Path) -> Path | None:
    runs = [r for r in _measurable(reports) if r.display_fps]
    if not runs:
        return None
    fig, ax = plt.subplots(figsize=(8, 4))
    xs = range(len(runs))
    ax.bar([x - 0.2 for x in xs], [r.display_fps or 0 for r in runs], width=0.4, color=CHANNEL_LOSS, label="exibido (tela)")
    ax.bar([x + 0.2 for x in xs], [r.capture_fps for r in runs], width=0.4, color=[COLORS[r.device_family] for r in runs])
    nominal = [(x + 0.2, r.camera_fps) for x, r in zip(xs, runs) if r.camera_fps]
    if nominal:
        ax.scatter([x for x, _ in nominal], [fps for _, fps in nominal], marker="_", s=500, color="black", zorder=3)
    ax.set_xticks(list(xs), [_tag(reports, r) for r in runs], rotation=20, ha="right", fontsize=8)
    ax.set_ylabel("quadros/s")
    ax.set_title("Taxa de exibição × taxa de captura do receptor")
    ax.grid(axis="x", visible=False)
    handles = [Patch(color=COLORS[f], label=f"capturado — {f}") for f in sorted({r.device_family for r in runs})]
    handles.append(Patch(color=CHANNEL_LOSS, label="exibido (tela)"))
    if nominal:
        handles.append(plt.Line2D([], [], marker="_", markersize=14, color="black", linestyle="", label="câmera (nominal)"))
    ax.legend(handles=handles, loc="center left", bbox_to_anchor=(1.0, 0.5), fontsize=8)
    return _save(fig, out_dir, "04_exibicao_vs_captura.png")


def fig_density(reports: list[TransferReport], out_dir: Path) -> Path | None:
    runs = [r for r in _measurable(reports) if r.sender and r.block_len and r.display_fps]
    if not runs:
        return None
    fig, ax = plt.subplots(figsize=(7, 4.3))
    series: dict[tuple[str, int, int], list[TransferReport]] = {}
    for r in runs:
        series.setdefault((r.device_family, round(r.display_fps or 0), r.codes_per_frame), []).append(r)
    for (family, fps, codes), mine in sorted(series.items()):
        mine.sort(key=lambda r: r.block_len or 0)
        ax.plot(
            [r.block_len or 0 for r in mine],
            [r.goodput_kbs for r in mine],
            marker={20: "v", 24: "o", 30: "*"}.get(fps, "s"),
            markersize=11 if fps == 30 else 7,
            color=COLORS[family],
            markerfacecolor="white" if codes > 1 else COLORS[family],
            linestyle="--" if codes > 1 else "-",
            label=f"{family} — {fps} fps ×{codes}",
        )
        for r in mine:
            qr = f"v{r.sender.qr_version}" if r.sender else ""
            ax.annotate(qr, (r.block_len or 0, r.goodput_kbs), xytext=(6, -3), textcoords="offset points", fontsize=8)
    ax.set_xlabel("bytes de payload por código (densidade do QR)")
    ax.set_ylabel("goodput (KB/s)")
    ax.set_title("Goodput × densidade do QR")
    ax.set_ylim(bottom=0)
    ax.legend(fontsize=8, loc="upper left")
    return _save(fig, out_dir, "05_goodput_vs_densidade.png")


def fig_fountain(reports: list[TransferReport], sim: list[SimRow], out_dir: Path) -> Path | None:
    if not sim:
        return None
    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    styles = {V1: (GRAY, "-"), V2: ("#2f81f7", "-"), SOLITON_ML: ("#2f81f7", ":")}
    for scheme, (color, line) in styles.items():
        rows = sorted((r for r in sim if r.scheme == scheme and (scheme != SOLITON_ML or r.k <= 100)), key=lambda r: r.k)
        if not rows:
            continue
        ks = [r.k for r in rows]
        ax.plot(ks, [r.mean for r in rows], color=color, linestyle=line, marker="o", markersize=3, label=f"simulado — {scheme}")
        if scheme != SOLITON_ML:
            ax.fill_between(ks, [r.p10 for r in rows], [r.p90 for r in rows], color=color, alpha=0.12)
    for version, marker, color in ((None, "s", GRAY), (2, "D", "#2f81f7")):
        points = [r for r in _measurable(reports) if (r.protocol_version or None) == version]
        if points:
            ax.scatter(
                [r.k for r in points],
                [r.overhead for r in points],
                marker=marker,
                color=color,
                edgecolor="black",
                s=45,
                zorder=4,
                label=f"medido — {'v2' if version else 'v1'} (tela→câmera)",
            )
    ax.set_xscale("log")
    ax.set_xlabel("K (blocos-fonte do arquivo)")
    ax.set_ylabel("frames recebidos ÷ K")
    ax.set_title("Overhead do fountain: peeling (v1) × eliminação gaussiana (v2)")
    ax.legend(fontsize=8)
    return _save(fig, out_dir, "06_overhead_fountain.png")


def render_all(reports: list[TransferReport], out_dir: Path, sim: list[SimRow] | None = None) -> list[Path]:
    """Writes the TCC figure set; figures without enough data are skipped."""
    out_dir.mkdir(parents=True, exist_ok=True)
    figures = [
        fig_goodput(reports, out_dir),
        fig_breakdown(reports, out_dir),
        fig_catch_vs_fps(reports, out_dir),
        fig_capture(reports, out_dir),
        fig_density(reports, out_dir),
        fig_fountain(reports, sim or [], out_dir),
    ]
    return [path for path in figures if path]
