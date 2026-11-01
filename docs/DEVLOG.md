# DEVLOG — diário de aprendizado contínuo

Registro do que foi feito, o que deu certo e o que deu errado. Entradas do mais
recente para o mais antigo.

## 2026-10-31 — Primeiros relatórios reais do v2: análise + roteiro de testes

### Feito
- Análise dos 10 relatórios de hoje (Android e iPhone, emissor MacBook 120 Hz) em
  [ROTEIRO-TESTES.md](ROTEIRO-TESTES.md), com 6 figuras para o TCC em `docs/figuras/`.
- Harness: descarta re-exportações vazias e sessões repetidas; tabela por run e por
  configuração (média ± desvio pela `?tag=`); estima a janela de troca W; simulação do
  fountain em Python (`fountain_sim.py`) para a figura de overhead × K.
- Correções de medição no receptor: a duração começa na **captura** do primeiro código
  (não na decodificação, que espera o wasm dos workers compilar); decodificações de um
  run anterior são ignoradas; o botão "Exportar diagnóstico" some ao concluir (gerava
  relatório com `fileBytes = 0`); `hit` não passa mais de 100%.
- Emissor: refresh medido pela média dos intervalos (a mediana de timestamps com
  resolução de 0,1 ms lia 120 Hz como 120,48).
- Receptor aceita `?tag=`, `?decode=`, `?fps=`, `?res=` para os experimentos; tudo vai
  para o relatório junto com o fps real da câmera e a resolução entregue ao decoder.
- Publicável na Vercel (URL fixa, sem túnel): o coletor virou `/api/diagnostics` — plugin
  do Vite no dev, função serverless com Blob privado no site. No site ele só aceita quem
  tem a chave (`?key=` uma vez por aparelho, guardada no navegador), e
  `npm run reports:pull` traz os relatórios para `analysis/reports/`.
- `vercel.json` em modo services: `app` (Vite, `/`) e `diagnostics` (a função, só
  `/api/diagnostics`); sem bindings, porque nenhum service chama outro pelo servidor.

### Aprendizados
- **Overhead 1,002–1,008 no campo** (K = 617–1254, inclusive acima do teto de 1024 da
  eliminação): a eliminação gaussiana entrega o que a simulação previa. O fountain saiu
  da lista de gargalos.
- **A vazão se perde no canal**: catch de 55–68% joga fora 32–45% da taxa da tela.
- **Zero duplicatas com a câmera mais rápida que a tela** (30 × 24 fps) revelou uma janela
  W ≈ 19 ms em torno de cada troca de código em que a captura sai misturada. Modelo
  `catch ≈ (T_tela − W)/T_captura` prevê 20 fps como ótimo robusto para câmera de 30 fps;
  os 97% a 30 fps vieram de fase travada (mesma taxa nos dois lados) — pode ter sido sorte.
- **Android limitado pela captura** (16–22 fps processados): em retrato o quadro 1080×1920
  vai inteiro para o decoder, porque o limite de 1280 px valia só para a largura.
- Densidade v27 → v36 no Android: +76% de goodput com o mesmo catch.
- Primeiro run com 4 códigos (Android, retrato): a tela ofereceu 135 KB/s, mas cada
  captura leu 1,2 dos 4 códigos — 35,1 KB/s. Em retrato falta resolução por código.
- Vercel em modo services **não constrói `api/`** (aviso `api_dir_ignored`): a função
  precisa ser um service próprio. E o `analysis/` não é service: sem entrypoint
  ASGI/WSGI o build falha (`MISSING_SERVICE_CONFIG`).

### Próximo
- Executar o roteiro (E0–E6), começando por E1 (fps) e E3 (`?decode=` no Android).
- Medir vários códigos por quadro com o celular na horizontal (E4).

## 2026-10-23 — Investigação do decimen (abordagem REA) → protocolo v2

### Método
Abordagem do [REA](https://github.com/morluto/rea): investigar como a feature
funciona no app de referência, **mostrar a evidência**, implementar a nossa versão e
testar. Alvo: [decimen](https://github.com/bashalarmistalt/decimen-optical-transfer)
(docs técnicas + `shared/fountain.ts`). É AGPL-3.0: usamos ideias e medições, nenhum
código copiado. Cada ideia passou por simulação ou teste antes de entrar.

### Feito
- **Fountain com eliminação gaussiana** (GF(2)) sobre o resíduo do peeling (≤ 1024
  incógnitas) — decodificação de máxima verossimilhança; **fountain linear denso**
  para K ≤ 64; índice bloco→pendentes no peeling; progresso por **posto** (resolvidos
  + pendentes) em vez de blocos resolvidos.
- **Determinismo (Fase 3)**: `detLn`/`detSqrt` só com `+ − × ÷` IEEE-754 + vetores-ouro.
- **Protocolo v2**: flags must-understand/ignorável, byte `codes`, erro tipado — o
  receptor diz qual versão viu em vez de ficar mudo.
- **QR**: capacidade por versão × ECC (corrige o crash de ECC H/Q com densidade
  alta; o rótulo "2071 B (v33)" estava errado — v33-L = 2068 B), versão e **máscara
  fixas** (2,1 → 0,28 ms por QR v27).
- **Vários códigos por quadro** (1/2/4); o receptor lê até N por captura.
- **Emissor**: loop por `requestAnimationFrame` com nº inteiro de refreshes por quadro
  (sem cadência 2-3-2-3), escala inteira por módulo, pré-render fora do vsync, wake lock.
- **Receptor**: contador de geração (trocar de câmera duplicava o loop de captura),
  wake lock, aviso de versão incompatível, recomeço automático se o SHA-256 falhar,
  **nome do arquivo recebido como texto** (ia para `innerHTML`: XSS vindo do QR) e
  blob inerte para download.
- **Rig de diagnóstico** (`/__diagnostics`, só no dev server): relatório salvo em
  `analysis/reports/` mesclado com o anúncio do emissor e seus travamentos; whitelist
  de campos, limite de tamanho e de quantidade (o túnel é público).
- Relatório ganha `catchRate`, `seqSpan`, duplicatas, redundantes, aquisição e códigos
  por quadro; harness Python lê v1 e v2. Testes: 22 → 42 (inclui e2e multi-código
  com o **zxing-wasm real** em Node).

### Aprendizados
- **Copiar sem medir teria piorado.** O decimen trocou o soliton por um carrossel
  sistemático; simulado com peeling e receptor entrando em ponto aleatório, ele só
  ganha para K pequeno — para 1 MB (K=728) fica 1.36x contra 1.17x do LT.
- **O gargalo do fountain era o decoder, não a distribuição.** Com eliminação, o
  mesmo LT completa com ~1.01–1.06·K em qualquer perda. E2E de transporte (K=65):
  1.72x/1.89x/1.25x → **1.06x/1.08x/1.05x** (0/20/40% de perda); demo loopback K=41:
  1.17x → 1.05x; 2×2 com zxing (K=25): 40 → 28 códigos.
- No ponto em que o ML completa, o peeling deixou **80–94% dos blocos** no resíduo: a
  eliminação resolve quase o sistema inteiro (custo ~U²) — daí o teto de 1024.
- Progresso por blocos resolvidos mente num fountain (fica baixo e salta no fim).
- `tryInvert: false` no zxing: códigos Farol nunca são invertidos; metade do trabalho
  nos quadros ilegíveis.
- Página oculta roda `requestAnimationFrame` irregular (~1 Hz): a medição do refresh
  precisa de fallback e travamento só conta com a aba visível.

### Próximo
- Medir no par Galaxy Book → S23: 1 vs 2 vs 4 códigos, 20/30 fps, v20/v27 — os
  relatórios agora chegam sozinhos em `analysis/reports/`.
- Recorte da região dos códigos em resolução cheia (o "fast path" rastreado do
  decimen-codec) quando 4 códigos ficarem pequenos demais a 1280 px.
- PWA offline (Fase 5).

## 2026-09-27 — Salto de throughput: zxing-wasm + parâmetros do decimen

### Feito
- **Decoder trocado para zxing-wasm** (WASM, rápido/robusto) no `/receive/`, como o
  decimen. `jsQR` fica como decoder de referência dos testes. `Receiver.offerBytes()`
  separa "bytes decodificados → fountain" do decode por imagem. `.wasm` servido do
  próprio origin (offline). Ver `docs/decisions/0005`.
- **Defaults do decimen**: 24 fps, 1465 B/frame (QR v27), ECC L. Densidades no
  `/send/` mapeadas a versões de QR (v10..v33).
- **Qualidade óptica no `/receive/`**: seleção automática da melhor câmera traseira
  (maior sensor) com override manual + persistência; foco contínuo via
  `applyConstraints`; captura 1080p; decode a 1280px; captura por
  `requestVideoFrameCallback`; telemetria ao vivo (câmera→leitura fps, hit%, KB/s, ETA).
- **Tela cheia no `/send/`**: QR físico grande → foco fácil de longe.
- Build valida o `.wasm` como asset local. Typecheck limpo, 22 testes verdes.

### Aprendizados
- O gargalo real de throughput é o **decoder**, não a densidade: jsQR (JS, main
  thread) é lento; zxing-wasm decodifica muito mais frames/s. É o que separa ~KB/s
  de dezenas/centenas de KB/s (decimen mede 418 KB/s desktop→phone).
- Overhead do fountain é **~1.15x** com LT bem feito, não 1.5-1.7x.
- Câmera wide de flagship (S23) não faz macro: o embaçado vem de perto demais —
  distância + QR grande resolvem mais que qualquer ajuste de software.
- libcimbar mostra o teto: sair do QR P&B para **cor** é o próximo salto de densidade.

### Próximo
- Decode em **Web Workers** (pool) — evolução direta do decimen.
- `PatternCodec` de **cor** (id=2) com homografia própria — direção libcimbar.
- Medir BER/goodput reais no par Galaxy Book → S23 e alimentar o harness Python.

## 2026-09-22 (tarde) — Codec QR + páginas send/receive com câmera

### Feito
- **`QrCodec` (id=1)**: `node-qrcode` (encode byte-mode) + `jsQR` (decode). jsQR faz
  localização dos finders, correção de perspectiva e amostragem → `decode` roda
  direto num frame de câmera, não só num canônico. RS embutido do QR = FEC
  intra-frame; fountain = apagadura (ECC fica em L).
- **Camada de sessão** (`app/shared/session.ts`): `Transmitter` + `Receiver` — DRY,
  usada por `/send/`, `/receive/` e pelo demo (refatorado). O `Receiver` engancha
  no stream pelo header e reinicia em novo `sessionId`.
- **Páginas**: `/send/` (arquivo → QR animado), `/receive/` (`getUserMedia` → jsQR →
  fountain → download), hub `/` com nav. Vite multipágina.
- **Testes**: round-trip QR (encode→jsQR), sessão loopback, E2E QR com 15% de perda.
  **22 testes verdes**, `tsc` limpo.
- **Validado no navegador**: `/send/` renderiza QR real (270×270) animando; `/receive/`
  abre a câmera e roda o loop de decode.

### Aprendizados
- `node-qrcode` funciona no browser via Vite passando `Uint8Array` direto em byte
  mode (sem `Buffer`) — confirmado.
- `getUserMedia` exige **HTTPS fora de localhost** → no celular só via túnel HTTPS
  (VS Code Ports público). Já deixamos `allowedHosts` no Vite.
- Usar `jsQR` resolve a visão computacional (finders/perspectiva) → evitamos
  escrever homografia à mão para o QR. O `GridCodec` (loopback) segue como o braço
  "grade densa" do estudo, onde a homografia própria entra depois.

### Próximo
- Testar **tela (PC) → câmera (celular)** via túnel; medir **BER/goodput reais**.
- Telemetria (log por `seq`) para o harness Python.
- `GridCodec` com marcadores + homografia para virar receptor de câmera também
  (comparação de padrões).

## 2026-09-22 — Primeiro "projeto rodando": E2E de transporte + demo loopback no navegador

### Feito
- **E2E de transporte** (`e2e/pipeline.e2e.test.ts`): arquivo → container → fountain
  → frames → canal simulado (perda + reordenação) → reconstrução + SHA-256. Verde a
  0/20/40% de perda (overhead 1.72x / 1.89x / 1.25x). `npm run e2e`.
- **Primeiro `PatternCodec` concreto**: `GridCodec` (grade P&B, 1 bit/célula, quiet
  zone). Puro sobre RGBA → testável fora do DOM.
- **Vite + demo loopback** (`index.html`, `app/demo/main.ts`): escolhe arquivo →
  padrões animados na tela → lê os próprios pixels de volta (câmera simulada) →
  reconstrói → SHA-256 → download. `npm run dev`.
- **Validado no navegador**: K=41, 48 frames, overhead 1.17x, SHA-256 OK, download
  do arquivo idêntico. 18 testes verdes no total.

### Aprendizados
- A pegadinha do TS 5.7 (`Uint8Array<ArrayBufferLike>`) **voltou, como previsto**, no
  canvas (`ImageData`) e no `Blob`. Convenção consolidada: `PatternImage.rgba` é
  `Uint8ClampedArray<ArrayBuffer>` (nativo do canvas) e `toArrayBufferBytes()` no
  limite do `Blob`/crypto.
- Vite resolve `./x.js` → `x.ts` sem config — o núcleo com extensões `.js` roda
  igual no dev server e no vitest.
- Loopback é **pixel-perfect**: threshold em 128 decodifica sem erro (0 símbolos
  errados). O ruído real (lente/luz/perspectiva) só entra quando a câmera de
  verdade plugar aqui — é o próximo marco, e é onde o BER começa a existir.

### Próximo
- Câmera real: captura `getUserMedia` + localização/homografia para o `GridCodec`
  tolerar perspectiva e ruído (hoje só loopback).
- Separar `send/` e `receive/` em páginas próprias + service worker (PWA offline).
- `PatternCodec` QR (id=1) como baseline comparável; cripto por palavra-chave.

## 2026-09-17 — Núcleo testável (container + protocolo + fountain)

### Feito
- Scaffold TypeScript (ESM, `strict`) + vitest. Node 22, sem framework.
- `app/shared/fountain.ts`: código LT (Luby Transform) com distribuição
  robust-soliton; encoder + decoder por *peeling*. 4 testes (ordem, apagadura,
  padding, redundância).
- `app/shared/protocol.ts`: header de frame auto-descritivo de 24 bytes + vetor-ouro.
- `app/shared/container.ts`: nome/tipo + gzip-quando-ajuda + SHA-256.
- `app/shared/pattern-codec.ts`: interface plugável (ainda sem implementação concreta).

### Aprendizados
- **Vetor-ouro bateu de primeira.** Fixar os bytes exatos do header (não só o
  round-trip) pega erros de layout que o round-trip esconde. Vale para toda
  serialização de fio — manter um golden por formato.
- **TS 5.7 / `Uint8Array<ArrayBufferLike>`.** APIs Web (`crypto.subtle.digest`,
  `Blob`, `CompressionStream`) exigem view sobre `ArrayBuffer`, não
  `SharedArrayBuffer`. Solução limpa: `toArrayBufferBytes()` no limite dessas
  APIs. Vai reaparecer no app (canvas / `ImageData`) — usar o mesmo padrão.
- **Determinismo do soliton (RISCO EM ABERTO).** `Math.log` diverge no último bit
  entre engines JS. Emissor e receptor precisam de CDF bit-idêntica ou derivam
  vizinhos diferentes e falham **em silêncio**. Hoje OK (mesmo engine nos testes);
  antes de `send`↔`receive` entre aparelhos, trocar por log determinístico
  (ver `docs/decisions/0003`). O PRNG (mulberry32) já é inteiro/estável de propósito.

### Próximo
- `PatternCodec` QR (baseline) + front-end de câmera compartilhado.
- Páginas `send/`/`receive/` (PWA offline).
