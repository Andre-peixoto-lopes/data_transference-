"""CLI: python -m farol_analysis [pasta-de-relatorios]  (padrao: reports)"""

from __future__ import annotations

import sys
from pathlib import Path

from .aggregate import diagnose, load_reports, table
from .plots import render_all


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("reports")
    if not folder.exists():
        print(f"pasta nao encontrada: {folder}")
        return 1
    reports = load_reports(folder)
    if not reports:
        print(f"nenhum relatorio .json em {folder}")
        return 1

    print(f"\n{len(reports)} relatorio(s) em {folder}\n")
    print(table(reports))
    print("\nDiagnostico:")
    for note in diagnose(reports):
        print(f"  - {note}")

    charts = render_all(reports, folder / "plots")
    print("\ngraficos:")
    for chart in charts:
        print(f"  - {chart}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
