# Roadmap — Farol

Plano concreto do POC atual até um TCC completo: **performático, medido, robusto e
entregável**. Ordenado por dependência. Sem estimativas de tempo — cada fase tem
critério de aceite **mensurável** e valida com `npm test`/`typecheck`/`build`.

> Princípio norteador: **medir antes de otimizar**. A Fase 0 existe para nenhum
> ganho ser "achismo" — todo salto é comprovado por número (goodput, hit%, BER).

## Estado atual (baseline qualitativo)
- QR animado + fountain LT; decoder **zxing-wasm** (main thread, async).
- Defaults do decimen: 24 fps, 1465 B/frame (QR v27), ECC L.
- Câmera: melhor lente automática, foco contínuo, telemetria ao vivo, decode 1280px, tela cheia.
- 22 testes verdes; sem cripto, sem PWA, sem harness, sem métricas persistidas.

## Marcos
| Fase | Objetivo | Tamanho | Depende de |
|---|---|---|---|
| 0 | Baseline medido (relatório JSON por transferência) | P | — |
| 1 | Web Workers pool no decode (salto de throughput) | M | 0 |
| 2 | Harness Python de análise (rigor do TCC) | M | 0 |
| 3 | Determinismo do soliton (cross-engine/iOS) | P | — |
| 4 | Cripto por palavra-chave (Argon2id + AEAD) | M | — |
| 5 | Entrega: PWA offline + APK Android | M | 1 |
| 6 | PatternCodec de cor (direção libcimbar) | G | 1, 2 |

---

## Fase 0 — Baseline medido
**Objetivo:** todo experimento gera um relatório reproduzível.
- 0.1 `app/shared/telemetry.ts` (novo): tipo `TransferReport` (K, densidade, fps, ecc,
  frames capturados/decodificados/únicos, hit%, overhead, goodput, duração, aparelhos).
- 0.2 `app/receive/main.ts`: acumular os contadores por `seq` e, ao concluir, **baixar o
  JSON** (e mostrar resumo na tela).
- 0.3 Payload canônico de benchmark (1 MB pseudoaleatório) selecionável no `/send/`.

**Aceite:** ao concluir uma transferência, um `farol-report-*.json` é baixado com
goodput e hit% reais. Baseline Galaxy Book → S23 registrado no DEVLOG.
**Valida:** transferência real + inspeção do JSON; `npm run typecheck`.

## Fase 1 — Web Workers pool no decode
**Objetivo:** tirar o zxing da main thread e decodificar frames **em paralelo** (é o
que leva o decimen a 400+ KB/s).
- 1.1 `app/receive/decode-worker.ts` (novo): carrega zxing-wasm e decodifica `ImageData`
  → bytes; responde via `postMessage`.
- 1.2 `app/receive/main.ts`: pool de `N = min(4, navigator.hardwareConcurrency)` workers;
  distribui frames por round-robin com `ImageData`/`ArrayBuffer` **transferível**.
- 1.3 **Dedupe por `seq`**: um `Set<number>` evita realimentar o fountain e evita decode
  redundante do mesmo QR.
- 1.4 **Backpressure**: não capturar novos frames enquanto todos os workers estão ocupados.

**Aceite:** goodput **≥ 2× o baseline da Fase 0** no mesmo par de aparelhos; UI não
trava (captura mantém ≥24 fps no relatório).
**Valida:** relatório JSON antes/depois; `npm test`; `npm run build` (worker no bundle).
**Risco:** custo de transferir `ImageData` grande → mitigar com downscale antes de enviar.

## Fase 2 — Harness de análise (Python)
**Objetivo:** transformar relatórios em métricas e gráficos para o TCC (ADR 0002).
- 2.1 `analysis/` (novo): `pyproject.toml`, modelos **Pydantic** espelhando `TransferReport`.
- 2.2 `analysis/aggregate.py`: lê uma pasta de relatórios → tabela (goodput, overhead,
  hit%, BER estimado) e varre parâmetros (densidade/fps/distância).
- 2.3 `analysis/plots.py`: matplotlib — goodput × densidade, hit% × distância, overhead × K.

**Aceite:** `python -m analysis reports/` gera CSV/tabela + PNGs a partir de ≥3 runs.
**Valida:** rodar sobre os relatórios da Fase 0/1; `.venv` já ignorado no `.gitignore`.

## Fase 3 — Determinismo do soliton
**Objetivo:** fechar o risco em aberto do [ADR 0003](decisions/0003-reliability-layering.md)
(`Math.log` não é bit-idêntico entre V8 e JavaScriptCore → falha **silenciosa** em iOS).
- 3.1 `app/shared/soliton.ts`: substituir `Math.log` na CDF por log **determinístico**
  (fixed-point ou tabela racional), mantendo a distribuição.
- 3.2 `app/shared/soliton.test.ts` (novo): **vetor-ouro** da CDF trava o determinismo.
- 3.3 Atualizar o ADR 0003 para "resolvido".

**Aceite:** golden test da CDF passa; `deriveNeighbours` idêntico para o mesmo `seq`
em qualquer engine.
**Valida:** `npm test` (novo golden); revisar diff da CDF.

## Fase 4 — Cripto por palavra-chave
**Objetivo:** confidencialidade opcional ([ADR 0004](decisions/0004-security-passphrase-aead.md)).
- 4.1 `app/shared/crypto.ts` (novo): KDF **Argon2id** + AEAD **XChaCha20-Poly1305**
  (libsodium.js); interface plugável.
- 4.2 `app/shared/container.ts`: flag de cripto + salt público no header; cifrar o corpo.
- 4.3 UI: campo de palavra-chave em `/send/` e `/receive/` (opcional).

**Aceite:** round-trip com senha certa; senha errada = falha de autenticação limpa
(nunca bytes errados); **golden vector** do container cifrado.
**Valida:** `npm test`; teste de senha errada.

## Fase 5 — Entrega: PWA offline + Android
**Objetivo:** instalável e funcional sem rede após a primeira visita.
- 5.1 `vite-plugin-pwa`: service worker que faz precache do app **e do `.wasm`** do zxing.
- 5.2 `public/manifest` + ícones (nome "Farol", `br.tcc.farol`).
- 5.3 Capacitor: `npm run build` → `npx cap add android` → `npx cap sync` → APK.

**Aceite:** app abre **offline** após 1ª visita; APK instala no S23 e abre `/receive/`
com câmera (permissão nativa).
**Valida:** DevTools → Offline; instalar o APK; `npm run build`.

## Fase 6 — PatternCodec de cor (fronteira, direção libcimbar)
**Objetivo:** saltar densidade além do QR P&B (libcimbar sustenta ~106 KB/s com cor).
- 6.1 `app/shared/patterns/color-grid-codec.ts` (novo, `id=2`): tiles com **cor**
  (2–4 bits/célula) + marcadores de canto para homografia.
- 6.2 Receptor: localizar marcadores → **homografia** → amostrar células → classificar
  cor com calibração; FEC intra-frame próprio (sem o RS do QR).
- 6.3 Testes: round-trip loopback pixel-exato + e2e com perda; comparar goodput vs QR no harness.

**Aceite:** e2e do color-codec verde; goodput **> QR** medido no harness (Fase 2).
**Valida:** `npm test`; corrida comparativa no harness.

---

## Riscos transversais
| Risco | Mitigação |
|---|---|
| Decode não acompanha a captura | Fase 1 (workers) + dedupe + backpressure |
| Falha silenciosa cross-engine (iOS) | Fase 3 (soliton determinístico + golden) |
| QR denso não decodifica na câmera | densidade ajustável + tela cheia + distância (já no app) |
| `straddling` (QR em transição) | fps = divisor do refresh; medir hit% por fps na Fase 2 |
| Regressão | `npm test`/`typecheck`/`build` a cada fase; ADR por decisão |

## Definição de "pronto" (TCC)
Transferência **Galaxy Book → S23** de 1 MB com **goodput medido e reproduzível**,
relatórios exportados e analisados no harness, determinismo garantido, app instalável
(PWA/APK), e — como contribuição de pesquisa — **comparação QR vs cor** com números.
