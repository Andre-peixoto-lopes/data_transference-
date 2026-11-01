"""CLI: python -m farol_analysis [pasta-de-relatorios] [pasta-dos-graficos]  (padrao: reports, reports/plots)"""

from __future__ import annotations

import sys
from pathlib import Path

from .aggregate import clean, diagnose, groups, load_reports, table
from .fountain_sim import load_or_simulate
from .plots import render_all


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("reports")
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else folder / "plots"
    if not folder.exists():
        print(f"pasta nao encontrada: {folder}")
        return 1
    loaded = load_reports(folder)
    if not loaded:
        print(f"nenhum relatorio .json em {folder}")
        return 1
    reports, dropped = clean(loaded)

    print(f"\n{len(loaded)} relatorio(s) em {folder}; {len(dropped)} descartado(s)")
    for note in dropped:
        print(f"  - {note}")
    print()
    print(table(reports))
    summary = groups(reports)
    if summary:
        print("\nPor configuracao (media ± desvio):\n")
        print(summary)
    print("\nDiagnostico:")
    for note in diagnose(reports):
        print(f"  - {note}")

    charts = render_all(reports, out_dir, load_or_simulate(out_dir / "fountain_sim.csv"))
    print("\ngraficos:")
    for chart in charts:
        print(f"  - {chart}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
