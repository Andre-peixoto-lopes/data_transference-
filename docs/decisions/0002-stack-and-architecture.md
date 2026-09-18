# 2. Stack: PWA em TypeScript + harness de análise em Python

- Status: aceito
- Data: 2026-09-17

## Contexto
Requisito: qualquer aparelho (celular ou desktop) deve poder **codificar e
decodificar**, offline, opcionalmente empacotado como APK. A novidade de pesquisa
são **padrões ópticos plugáveis** (QR, cores, densa), que exigem visão
computacional própria no receptor, em tempo real. O projeto de referência
(decimen) valida um PWA em TypeScript para exatamente esse canal.

## Decisão
- **Produto = PWA em TypeScript** (páginas `send/` e `receive/`, offline via
  service worker, empacotável como APK via PWABuilder/TWA ou Capacitor).
- **Ciência = harness em Python** que consome logs de telemetria (JSON) do
  receptor e calcula as métricas (BER, goodput, overhead), com modelos Pydantic.
- Python **não** roda o caminho em tempo real (câmera/CV no navegador é mais
  limpo e portátil que Python no celular).

## Consequências
- Emissor e receptor compartilham um único código TS → sem "taxa de determinismo
  entre linguagens" no caminho de produção.
- Python fica onde brilha (análise de dados), respeitando a linguagem de conforto.
- Custo: a CV de padrões custom no navegador tem teto de desempenho; aceitável
  para POC (começamos pelo QR, comprovado).
