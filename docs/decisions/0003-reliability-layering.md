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
- **Risco em aberto (determinismo)**: a CDF robust-soliton usa `Math.log`, que não
  é bit-idêntico entre engines JS. Antes de `send`↔`receive` entre aparelhos
  distintos, substituir por implementação determinística (fixed-point) e fixar
  vetores-ouro. O PRNG de vizinhança já é inteiro/estável.
