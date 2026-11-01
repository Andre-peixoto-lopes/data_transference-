# Harness de análise — Farol

Transforma os relatórios JSON exportados pelo `/receive/` em **tabela**,
**diagnóstico** e **gráficos** (goodput, hit rate, densidade). É o insumo do
capítulo de resultados do TCC (Fase 2 do [roadmap](../docs/ROADMAP.md)).

## Uso

```powershell
cd analysis
py -m venv .venv
.venv\Scripts\python -m pip install -e .
.venv\Scripts\python -m farol_analysis reports                  # gráficos em reports/plots/
.venv\Scripts\python -m farol_analysis reports ..\docs\figuras   # figuras do TCC
```

Com `npm run dev`, cada transferência concluída no `/receive/` já é salva em
`analysis/reports/` (via `/api/diagnostics`, com as configurações do emissor mescladas);
no site publicado os relatórios ficam num Blob privado e `npm run reports:pull` (na raiz)
os traz para cá; sem coletor, o JSON é baixado no receptor e vai para a mesma pasta. O harness
descarta re-exportações vazias (`fileBytes = 0`) e sessões repetidas, imprime a tabela
por run, a tabela por configuração (média ± desvio, agrupando a `?tag=` sem o `-rN`) e o
diagnóstico, e grava 6 figuras (300 dpi). A Fig. 6 usa a simulação do fountain
([fountain_sim.py](farol_analysis/fountain_sim.py)), em cache em `fountain_sim.csv` ao lado
das figuras. Roteiro de testes: [docs/ROTEIRO-TESTES.md](../docs/ROTEIRO-TESTES.md).

## Métricas
- **goodputKBs** — bytes do arquivo por segundo (o número que importa).
- **catchRate** — códigos distintos lidos ÷ códigos que o emissor exibiu enquanto o
  receptor olhava (`seqSpan`). Baixo = o receptor perdeu quadros (foco, straddling,
  pool ocupado). Relatórios v2.
- **hitRate** — códigos novos ÷ (capturas × códigos por quadro). Baixo = straddling/foco.
- **captureFps** — frames por segundo que câmera + workers processam.
- **QR/s** — QRs distintos lidos por segundo (progresso real).
- **overhead** — frames decodificados ÷ K (v2 com eliminação: ~1.05; v1: 1.15–1.9).
- **codes** — códigos por quadro do emissor; **bytesPerFrame** — densidade do QR.
- **sender** — versão do QR, ECC, fps alvo/efetivo, refresh e travamentos do emissor.
- **W ms** (derivado) — janela ao redor de cada troca de código em que a captura se
  perde, de `catch ≈ (T_tela − W) / T_captura`; não é calculado quando câmera e tela
  rodam na mesma taxa (fase travada).
- **cameraFps / decodeResolution / tag** — o que a câmera entregou, o tamanho entregue
  ao decoder e o rótulo do experimento (`?tag=`), desde 31/10.

O diagnóstico segue a ordem do decimen: travamento do emissor → catch baixo
(captura) → overhead alto com catch alto (fountain).

## Como varrer parâmetros
Siga o [roteiro de testes](../docs/ROTEIRO-TESTES.md): um run por configuração com
`?tag=<experimento>-<config>-rN` no receptor, 3 repetições, e rode o harness.
