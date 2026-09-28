"""Render comparison charts from a list of transfer reports."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless: write PNGs without a display

import matplotlib.pyplot as plt  # noqa: E402

from .models import TransferReport

_BLUE = "#2f81f7"


def _bars(ax: "plt.Axes", labels: list[str], values: list[float], title: str, ylabel: str) -> None:
    ax.bar(labels, values, color=_BLUE)
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(axis="y", alpha=0.3)


def render_all(reports: list[TransferReport], out_dir: Path) -> list[Path]:
    """Writes goodput/hit-rate bars, plus goodput-vs-density when density varies."""
    out_dir.mkdir(parents=True, exist_ok=True)
    labels = [f"#{i + 1}" for i in range(len(reports))]
    written: list[Path] = []

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    _bars(axes[0], labels, [r.goodput_kbs for r in reports], "Goodput por run", "KB/s")
    _bars(axes[1], labels, [r.hit_rate * 100 for r in reports], "Hit rate por run", "%")
    fig.tight_layout()
    path = out_dir / "goodput_hitrate.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    written.append(path)

    density = [(r.bytes_per_frame, r.goodput_kbs) for r in reports if r.bytes_per_frame]
    if len({d for d, _ in density}) >= 2:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.scatter([d for d, _ in density], [g for _, g in density], color=_BLUE)
        ax.set_title("Goodput x densidade")
        ax.set_xlabel("bytes/frame")
        ax.set_ylabel("KB/s")
        ax.grid(alpha=0.3)
        fig.tight_layout()
        path = out_dir / "goodput_vs_density.png"
        fig.savefig(path, dpi=120)
        plt.close(fig)
        written.append(path)

    return written
