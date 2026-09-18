# DEVLOG — diário de aprendizado contínuo

Registro do que foi feito, o que deu certo e o que deu errado. Entradas do mais
recente para o mais antigo.

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
