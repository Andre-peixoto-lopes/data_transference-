---
name: adding-a-pattern-codec
description: Add a new optical PatternCodec (QR, colour grid, dense grid, shapes) to Farol so it can be compared in the empirical study. Use when implementing or registering a new visual modulation scheme.
---

# Adicionar um PatternCodec

Um `PatternCodec` ([app/shared/pattern-codec.ts](../../../app/shared/pattern-codec.ts))
mapeia os bytes de um frame fountain para uma imagem e de volta. É o ponto plugável
do estudo: cada esquema é comparado nas mesmas condições porque o front-end de
câmera (localizar → homografia → amostrar) é **compartilhado**; só o mapeamento
célula→bits muda.

## Passos
1. **Escolha um `id` único (u8).** Ele vai no header do frame (`patternId`) e nunca
   pode colidir. Registre-o na tabela em [docs/protocol.md](../../../docs/protocol.md).
2. **Implemente** `app/shared/patterns/<nome>.ts`:
   - `bytesPerFrame()`: capacidade real de payload por frame (dita o `blockLen`).
   - `encode(frameBytes)`: desenhe os marcadores de registro **compartilhados** +
     as células de dados; retorne `PatternImage` (RGBA).
   - `decode(image)`: reuse o front-end compartilhado para retificar a imagem;
     classifique as células; retorne `DecodedSymbol` (com `estimatedSymbolErrors`
     para BER) ou `Erasure`.
3. **Testes** (`app/shared/patterns/<nome>.test.ts`):
   - round-trip `encode`→`decode` sem ruído (bit-exato);
   - degradação graciosa: com desfoque/ruído sintético leve, ainda decodifica ou
     retorna `Erasure` (nunca bytes errados em silêncio);
   - se houver FEC intra-frame, um teste que corrige N erros de símbolo.
4. **Vetor-ouro**: fixe os bytes de pelo menos um frame de exemplo (pega drift).

## Regras
- **Marcadores de registro idênticos** entre codecs — o front-end é DRY.
- `decode` nunca devolve bytes possivelmente corrompidos como `symbol`: na dúvida,
  `Erasure` (o fountain absorve a perda).
- Documente capacidade e sensibilidade esperada (luz/distância) no DEVLOG.
