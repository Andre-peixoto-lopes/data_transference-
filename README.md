# Farol

Transferência de arquivos por **luz**: um dispositivo exibe o arquivo como um fluxo
de padrões ópticos animados na tela; outro aponta a câmera e reconstrói o arquivo.
Sem Wi-Fi, Bluetooth ou cabo — o dado viaja como imagem.

> Codinome provisório ("farol" = sinalização óptica), fácil de renomear. POC de TCC
> sobre **Comunicação Tela-Câmera (Screen-Camera Communication)**.

## Arquitetura (4 camadas ortogonais)

| Camada | Responsabilidade | Onde |
|---|---|---|
| Container | nome/tipo do arquivo, gzip quando ajuda, SHA-256 | [container.ts](app/shared/container.ts) |
| Cripto (AEAD) | confidencialidade por palavra-chave | _(a implementar)_ |
| Fountain (rateless) | apagadura: reconstrói de qualquer ~K·(1+ε) frames | [fountain.ts](app/shared/fountain.ts) |
| PatternCodec | modulação visual (QR, cores, densa) | [pattern-codec.ts](app/shared/pattern-codec.ts) |

Transporte físico: **tela → câmera**. Sem canal de retorno; frames perdidos custam
tempo, nunca correção.

## Estado atual
- [x] Núcleo testável: container, protocolo de frame, fountain LT — **12 testes verdes**.
- [ ] `PatternCodec` QR (baseline) + front-end de câmera compartilhado.
- [ ] Páginas `send/` e `receive/` (PWA offline).
- [ ] Cripto por palavra-chave (Argon2id + AEAD).
- [ ] Harness de análise em Python + experimentos.

## Rodar
```bash
npm install
npm test         # vitest
npm run typecheck
```

## Documentação
- Protocolo de fio: [docs/protocol.md](docs/protocol.md)
- Decisões de arquitetura: [docs/decisions/](docs/decisions/)
- Diário de aprendizado contínuo: [docs/DEVLOG.md](docs/DEVLOG.md)
# data_transference-
