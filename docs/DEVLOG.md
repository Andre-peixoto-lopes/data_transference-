# DEVLOG — diário de aprendizado contínuo

Registro do que foi feito, o que deu certo e o que deu errado. Entradas do mais
recente para o mais antigo.

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
