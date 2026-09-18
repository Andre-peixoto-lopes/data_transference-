---
name: running-an-experiment
description: Run a reproducible screen-to-camera experiment for Farol and collect BER/goodput/overhead metrics. Use when measuring performance vs lighting, distance, angle, or pattern scheme.
---

# Rodar um experimento

O produto é o instrumento: a decodificação é **ao vivo** (sem gravar vídeo). A
reprodutibilidade vem de **rig controlado + repetições** e de um **log leve de
telemetria** (bits/símbolos por `seq`, sem imagem) que o harness Python analisa.

## Rig
- Suporte fixo (tripé) para o receptor; distância e ângulo marcados.
- Iluminação medida (lux); brilho e refresh da tela anotados.
- Uma variável por vez; N repetições por célula da matriz (reporte média + IC).

## Métricas (definições)
- **BER de símbolo**: por frame, compare os símbolos lidos com o ground-truth
  reconstruído do `seq` (determinístico). Mede corrupção intra-frame.
- **Taxa de apagadura de frame**: frames perdidos ÷ frames exibidos.
- **Overhead do fountain**: frames coletados ÷ K (ideal → 1).
- **Goodput**: bytes úteis ÷ tempo total (após todo overhead).
- **Sucesso**: SHA-256 bit-exato (pass/fail duro).

## Procedimento
1. Escolha o corpus (txt/xlsx compressíveis; mp3/mp4 incompressíveis; ~10K/100K/1M).
2. Fixe os parâmetros do stream (codec, FPS, ε, nível de FEC) e registre-os.
3. Rode N repetições; exporte o log de telemetria (JSON) do receptor.
4. Em `analysis/`, rode o harness Python (Pydantic valida o schema do log) para
   agregar métricas e gerar gráficos.
5. Anote os achados no DEVLOG (o que ajudou/atrapalhou).
