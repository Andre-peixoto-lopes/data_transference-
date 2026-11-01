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
ponto; um novo `sessionId` reinicia o receptor. **Versão atual: 2.**

| offset | tipo | campo | significado |
|---:|---|---|---|
| 0 | u8 | magic0 = `0xD1` | "isto é um frame Farol" |
| 1 | u8 | magic1 = `0xC3` | (idem) |
| 2 | u8 | version | versão do formato (gate de parsing) — `2` |
| 3 | u8 | flags | nibble baixo `0x0F`: **must-understand**; nibble alto `0xF0`: pode ignorar |
| 4 | u16 | sessionId | identidade do stream |
| 6 | u32 | seq | número de sequência do frame |
| 10 | u16 | k | nº de blocos-fonte (≤ 65535) |
| 12 | u16 | blockLen | bytes por bloco |
| 14 | u32 | totalLen | tamanho do payload original |
| 18 | u8 | patternId | qual `PatternCodec` gerou o stream |
| 19 | u8 | codes | códigos exibidos por quadro (informativo; `0` = 1) |
| 20 | u8×4 | reservado | zeros |

**Identidade do stream**: `version:sessionId:k:blockLen:totalLen:patternId` — os
campos que precisam ser constantes para os frames pertencerem ao mesmo envio.

**Regras de evolução** (como no decimen): magic diz "é nosso"; `version` decide o
parsing inteiro, e um receptor que encontra outra versão **diz qual viu** em vez de
ficar mudo (`UnsupportedFrameError`); um bit must-understand desconhecido rejeita o
frame, um bit do nibble alto é ignorado — um recurso novo custa um bit, não uma
quebra de versão.

## Vários códigos por quadro
O emissor pode ladrilhar `codes` QRs **da mesma versão** num quadro (2 = lado a lado,
4 = grade 2×2). O quadro exibido `i` carrega os seqs `i·codes … i·codes+codes−1`, cada
um um frame independente; o receptor lê até `codes` símbolos por captura
(`maxNumberOfSymbols`) e o fountain não distingue de onde vieram.

## Fountain (camada de apagadura)
O símbolo do frame `seq` é o XOR de um subconjunto pseudoaleatório dos `k` blocos,
derivado **deterministicamente** de `seq` (PRNG mulberry32), então a lista de
índices **não** trafega. Emissor e receptor derivam o mesmo conjunto.

| regime | composição do frame | por quê |
|---|---|---|
| `k ≤ 64` | cada bloco entra com probabilidade ½ (fountain linear denso) | eliminação decodifica com ~K+2 frames |
| `k > 64` | grau robust-soliton (`c=0.03`, `δ=0.05`) + índices por Fisher–Yates parcial | XOR ~log K por frame |

**Decodificação**: *peeling* (propagação de crença) + **eliminação gaussiana em
GF(2)** sobre o resíduo assim que há tantas equações pendentes quanto blocos
desconhecidos (até 1024 incógnitas). Isso é decodificação de máxima verossimilhança:
completa com ~K·1.01–1.06 frames em vez dos ~K·1.15–1.9 do peeling sozinho.

> Determinismo: a CDF do soliton usa `detLn`/`detSqrt` (só `+ − × ÷` IEEE-754,
> corretamente arredondados ⇒ bit-idênticos em V8 e JavaScriptCore), fixados por
> vetores-ouro em `soliton.test.ts` e `fountain.test.ts` — ver `docs/decisions/0003`.

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
bit-exata ou nada (se falhar, a recepção recomeça sozinha).

## Camada QR
ECC fica em **L** por padrão (o fountain cuida de apagaduras; o RS do QR, de
corrupção). A **versão** do QR é fixada pelo emissor (todos os quadros com o mesmo
tamanho) e a capacidade sai da tabela versão × ECC (`qrByteCapacity`); a **máscara é
fixa** (`0`) — qualquer máscara declarada é válida para o decoder, e pular a avaliação
das 8 máscaras deixa a geração ~7× mais rápida (2,1 → 0,28 ms por QR v27).

## Tabela de `patternId`
| id | codec | status |
|---:|---|---|
| 1 | QR (baseline) | implementado — zxing-wasm no receptor, jsQR nos testes |
| 2 | grade de cores | planejado (direção libcimbar) |
| 3 | grade P&B (`GridCodec`) | implementado (loopback; sem homografia p/ câmera) |

Ids são estáveis e não podem colidir — um novo `PatternCodec` escolhe o próximo id livre.
