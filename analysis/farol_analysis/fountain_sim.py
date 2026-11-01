"""Fountain overhead x K: v1 (robust soliton + peeling) vs v2 (dense <= 64 | soliton + Gaussian elimination).

Index-only model of app/shared/fountain.ts (same c, delta and dense cutoff): it counts the
frames a receiver needs, never touches payload bytes. Loss does not change these curves —
fresh LT frames are interchangeable, so a lossy channel only thins the stream.
"""

from __future__ import annotations

import bisect
import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

C, DELTA, DENSE_MAX_K = 0.03, 0.05, 64  # mirror app/shared/fountain.ts
K_VALUES = (10, 16, 25, 40, 64, 100, 160, 250, 400, 728, 1000, 1500)
V1, SOLITON_ML, V2 = "v1: soliton + peeling", "soliton + eliminação", "v2: Farol (denso ≤ 64) + eliminação"


@dataclass(frozen=True)
class SimRow:
    k: int
    scheme: str
    mean: float  # frames received / K
    p10: float
    p90: float
    trials: int


def soliton_cdf(k: int) -> list[float]:
    """cdf[d - 1] = P(degree <= d) for the robust soliton distribution."""
    rho = [0.0, 1.0 / k] + [1.0 / (d * (d - 1)) for d in range(2, k + 1)]
    strength = C * math.log(k / DELTA) * math.sqrt(k)
    spike = max(1, round(k / strength))
    tau = [0.0] * (k + 1)
    for d in range(1, k + 1):
        if d < spike:
            tau[d] = strength / (d * k)
        elif d == spike:
            tau[d] = strength * math.log(strength / DELTA) / k
    total = sum(rho[1:]) + sum(tau[1:])
    cdf, acc = [], 0.0
    for d in range(1, k + 1):
        acc += (rho[d] + tau[d]) / total
        cdf.append(acc)
    cdf[-1] = 1.0
    return cdf


def _neighbours(rng: random.Random, k: int, cdf: list[float], dense: bool) -> list[int]:
    if dense:
        return [i for i in range(k) if rng.random() < 0.5] or [rng.randrange(k)]
    degree = bisect.bisect_left(cdf, rng.random()) + 1
    return rng.sample(range(k), min(degree, k))


def frames_peeling(k: int, rng: random.Random, cdf: list[float]) -> int:
    """Belief-propagation peeling only (protocol v1 decoder)."""
    solved = [False] * k
    covering: list[list[set[int]]] = [[] for _ in range(k)]
    n_solved = received = 0
    while n_solved < k:
        received += 1
        equation = {i for i in _neighbours(rng, k, cdf, False) if not solved[i]}
        if len(equation) > 1:
            for i in equation:
                covering[i].append(equation)
            continue
        queue = list(equation)
        while queue:
            block = queue.pop()
            if solved[block]:
                continue
            solved[block] = True
            n_solved += 1
            for pending in covering[block]:
                pending.discard(block)
                if len(pending) == 1:
                    queue.append(next(iter(pending)))
            covering[block] = []
    return received


def frames_elimination(k: int, rng: random.Random, cdf: list[float], dense: bool) -> int:
    """Maximum-likelihood decoding: done when the received equations reach rank K over GF(2)."""
    pivots: dict[int, int] = {}
    received = 0
    while len(pivots) < k:
        received += 1
        row = 0
        for i in _neighbours(rng, k, cdf, dense):
            row |= 1 << i
        while row:
            lowest = row & -row
            pivot = pivots.get(lowest)
            if pivot is None:
                pivots[lowest] = row
                break
            row ^= pivot
    return received


def simulate(seed: int = 0xFA401) -> list[SimRow]:
    rng = random.Random(seed)
    rows: list[SimRow] = []
    for k in K_VALUES:
        cdf = soliton_cdf(k)
        trials = 200 if k <= 100 else 60
        runs = {
            V1: lambda: frames_peeling(k, rng, cdf),
            SOLITON_ML: lambda: frames_elimination(k, rng, cdf, False),
        }
        if k <= DENSE_MAX_K:
            runs[V2] = lambda: frames_elimination(k, rng, cdf, True)
        for scheme, run in runs.items():
            ratios = sorted(run() / k for _ in range(trials))
            rows.append(SimRow(k, scheme, mean(ratios), ratios[trials // 10], ratios[(9 * trials) // 10], trials))
        if k > DENSE_MAX_K:  # above the dense cutoff v2 *is* soliton + elimination
            rows.append(SimRow(k, V2, *[getattr(rows[-1], f) for f in ("mean", "p10", "p90", "trials")]))
    return rows


def save(rows: list[SimRow], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["k", "scheme", "mean", "p10", "p90", "trials"])
        for row in rows:
            writer.writerow([row.k, row.scheme, f"{row.mean:.4f}", f"{row.p10:.4f}", f"{row.p90:.4f}", row.trials])


def load(path: Path) -> list[SimRow]:
    with path.open(encoding="utf-8") as handle:
        return [
            SimRow(int(r["k"]), r["scheme"], float(r["mean"]), float(r["p10"]), float(r["p90"]), int(r["trials"]))
            for r in csv.DictReader(handle)
        ]


def load_or_simulate(path: Path) -> list[SimRow]:
    """The simulation is cached next to the figures (delete the CSV to rerun it)."""
    if path.exists():
        return load(path)
    print("simulando o fountain (fica em cache em fountain_sim.csv)...")
    rows = simulate()
    save(rows, path)
    return rows


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("reports/plots/fountain_sim.csv")
    save(simulate(), out)
    print(f"gravado: {out}")
