# Protocolo de fio (Farol)

Visão geral do que viaja em cada frame óptico. Os bytes exatos são fixados por
vetores-ouro em `app/shared/*.test.ts`.

## O problema do canal unidirecional
Tela → câmera não tem canal de retorno: o receptor não pede retransmissão e vai
perder frames (blur, foco, straddling de refresh). Por isso o emissor transmite um
fluxo **rateless** (fountain) — o receptor coleta qualquer ~K·(1+ε) frames, em
qualquer ordem, e reconstrói.

## Frame = header (24 bytes) + símbolo
Header auto-descritivo, big-endian. O receptor "engancha" no stream em qualquer
ponto; um novo `sessionId` reinicia o receptor.

| offset | tipo | campo | significado |
|---:|---|---|---|
| 0 | u8 | magic0 = `0xD1` | "isto é um frame Farol" |
| 1 | u8 | magic1 = `0xC3` | (idem) |
| 2 | u8 | version | versão do formato (gate de parsing) |
| 3 | u8 | flags | reservado para evolução |
| 4 | u16 | sessionId | identidade do stream |
| 6 | u32 | seq | número de sequência do frame |
| 10 | u16 | k | nº de blocos-fonte |
| 12 | u16 | blockLen | bytes por bloco |
| 14 | u32 | totalLen | tamanho do payload original |
| 18 | u8 | patternId | qual `PatternCodec` gerou o stream |
| 19 | u8×5 | reservado | zeros |

**Identidade do stream**: `version:sessionId:k:blockLen:totalLen:patternId` — os
campos que precisam ser constantes para os frames pertencerem ao mesmo envio.

## Fountain (camada de apagadura)
O símbolo do frame `seq` é o XOR de um subconjunto pseudoaleatório dos `k` blocos.
O subconjunto é derivado **deterministicamente** de `seq` (grau via robust-soliton,
índices via Fisher–Yates parcial com PRNG mulberry32), então a lista de índices
**não** trafega. Emissor e receptor derivam o mesmo conjunto.

> Determinismo: o PRNG é inteiro/estável entre engines; a CDF do soliton usa
> `Math.log` e ainda **não** é garantidamente bit-idêntica entre engines — ver
> `docs/decisions/0003`.

## Container (dentro do payload do fountain)
Big-endian. Preserva metadados, comprime só quando ajuda e verifica integridade.

| offset | tipo | campo |
|---:|---|---|
| 0 | u8 | flags (bit0 = gzip) |
| 1 | u16 | tamanho do filename |
| 3 | u16 | tamanho do mediaType |
| 5 | u32 | tamanho original do payload |
| 9 | [32] | SHA-256 do payload original |
| 41 | … | filename \| mediaType \| corpo (gzip ou cru) |

O receptor só entrega o arquivo após **verificar o SHA-256** — reconstrução
bit-exata ou nada.

## Tabela de `patternId`
| id | codec | status |
|---:|---|---|
| 1 | QR (baseline) | planejado |
| 2 | grade de cores | planejado |
| 3 | grade binária densa | planejado |

Ids são estáveis e não podem colidir (ver skill `adding-a-pattern-codec`).
