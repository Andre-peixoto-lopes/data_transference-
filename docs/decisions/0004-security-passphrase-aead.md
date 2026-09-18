# 4. Segurança: confidencialidade por palavra-chave (AEAD + Argon2id)

- Status: aceito
- Data: 2026-09-17

## Contexto
Objetivo: só quem informar a **palavra-chave compatível** reconstrói o arquivo. O
canal é offline e observável (qualquer câmera vê a tela).

## Decisão
- Derivar a chave da palavra-chave com **Argon2id** (salt público no header do
  container; parâmetros de custo altos).
- Cifrar com **AEAD** (XChaCha20-Poly1305 ou AES-256-GCM); palavra errada → falha
  de autenticação limpa.
- Expor a cripto como **módulo plugável**; uma implementação (palavra-chave) bem
  feita agora, sealed-box X25519 (ligado ao dispositivo) como trabalho futuro.
- Biblioteca: libsodium (libsodium.js no navegador).

## Consequências
- Ameaça real: quem **filma** o stream pode fazer brute-force **offline** de
  palavras fracas → mitigado por KDF forte + orientação de alta entropia
  (documentar no capítulo de segurança).
- A confidencialidade depende do segredo da palavra-chave, não do dispositivo —
  essa é a diferença para o sealed-box, deixado como evolução.
