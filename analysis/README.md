# Harness de análise — Farol

Transforma os relatórios JSON exportados pelo `/receive/` em **tabela**,
**diagnóstico** e **gráficos** (goodput, hit rate, densidade). É o insumo do
capítulo de resultados do TCC (Fase 2 do [roadmap](../docs/ROADMAP.md)).

## Uso

```powershell
cd analysis
py -m venv .venv
.venv\Scripts\python -m pip install -e .
.venv\Scripts\python -m farol_analysis reports
```

Cada `farol-report-*.json` baixado no receptor vai em `analysis/reports/`. A saída
imprime a tabela + diagnóstico e grava PNGs em `analysis/reports/plots/`.

## Métricas
- **goodputKBs** — bytes do arquivo por segundo (o número que importa).
- **hitRate** — frames decodificados ÷ capturados. Baixo = straddling/foco.
- **captureFps** — frames por segundo que câmera + workers processam.
- **QR/s** — QRs distintos lidos por segundo (progresso real).
- **overhead** — frames decodificados ÷ K (ideal ~1.15; alto para K pequeno).
- **bytesPerFrame** — densidade do QR (quando o relatório informa).

## Como varrer parâmetros
Faça um run por configuração no `/send/` (mude fps/densidade), exporte o JSON de
cada um para `reports/` e rode o harness: a tabela ordena por goodput e o
diagnóstico aponta o gargalo de cada run.
