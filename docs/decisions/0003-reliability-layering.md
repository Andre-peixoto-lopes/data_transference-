# 3. Confiabilidade em camadas: fountain (apagadura) + FEC intra-frame (corrupção)

- Status: aceito
- Data: 2026-09-17

## Contexto
Um enlace tela→câmera não tem canal de retorno e perde frames (blur, foco,
straddling de refresh). FEC dentro de um frame (Reed-Solomon/Hamming) **não**
recupera um frame que nunca chegou — isso é uma **apagadura** no eixo do tempo.

## Decisão
Duas camadas ortogonais:
- **Inter-frame (apagadura)**: código fountain rateless (LT). O receptor coleta
  qualquer ~K·(1+ε) frames, em qualquer ordem, e reconstrói.
- **Intra-frame (corrupção)**: FEC embutido do próprio padrão (o QR já traz
  Reed-Solomon; padrões custom declaram o seu).

RS/Hamming são, portanto, um botão **intra-frame** — nunca o mecanismo de
recuperação de frame perdido.

## Consequências
- ε (overhead do fountain) e o nível de FEC intra-frame viram variáveis
  experimentais limpas.
- ~~**Risco em aberto (determinismo)**~~ — **resolvido no protocolo v2**
  (2026-10-23): a CDF usa `detLn`/`detSqrt`, construídos só com `+ − × ÷` IEEE-754
  (corretamente arredondados ⇒ bit-idênticos entre engines), com vetores-ouro da
  CDF e dos conjuntos de vizinhos.

## Atualização 2026-10-23 — decodificação e composição dos frames
Investigação no estilo REA (evidência antes de implementar) sobre o decimen
(`shared/fountain.ts` e docs técnicas): no wire v2 ele trocou o robust-soliton por um
**carrossel sistemático** (varredura dos K blocos + K frames de reparo). Simulamos
antes de copiar (receptor travando em ponto aleatório do stream, decodificação só por
peeling, frames exibidos ÷ K):

| K | perda | LT soliton (v1) | carrossel u[2,16] |
|---:|---:|---:|---:|
| 63 | 0% | 1.50 | 1.22 |
| 300 | 0% | 1.26 | 1.32 |
| 728 | 0% | 1.17 | 1.36 |
| 728 | 30% | 1.69 | 2.01 |

O carrossel só ganha para K pequeno; para arquivos de verdade (K≈728 = 1 MB) é pior.
O ganho real estava no **decoder**: com eliminação gaussiana (máxima
verossimilhança) o mesmo LT completa com **~K·1.00–1.06 frames recebidos** em
qualquer perda, e um fountain linear denso faz ainda melhor para K ≤ 64
(K=25: 1.06 vs 1.18).

**Decisão**: manter LT robust-soliton para K > 64, usar fountain linear denso para
K ≤ 64, e decodificar com peeling + eliminação gaussiana sobre o resíduo (≤ 1024
incógnitas). O carrossel sistemático foi avaliado e **rejeitado** com números.
Medido no e2e de transporte (K=65, com reordenação): overhead 1.72x/1.89x/1.25x →
**1.06x/1.08x/1.05x** com 0/20/40% de perda.
