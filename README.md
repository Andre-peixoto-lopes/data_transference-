# Farol

Transferência de arquivos por **luz**: um dispositivo exibe o arquivo como um fluxo
de QR codes animados na tela; outro aponta a câmera e reconstrói o arquivo
bit-a-bit. Sem Wi-Fi, Bluetooth, cabo ou servidor — o dado viaja como imagem.

> POC de TCC sobre **Comunicação Tela-Câmera** (*Screen-Camera Communication*).
> Inspirado no [decimen](https://github.com/bashalarmistalt/decimen-optical-transfer)
> (QR animado + fountain) e no [libcimbar](https://github.com/sz3/libcimbar)
> (barcodes de cor, o estado da arte em densidade).

## Como funciona

Um enlace tela→câmera **não tem canal de retorno**: o receptor não pede
retransmissão e vai perder frames (blur, foco, timing de refresh). Por isso o
emissor transmite um fluxo **rateless** (código fountain LT): cada QR carrega o
XOR de um subconjunto pseudoaleatório dos blocos-fonte, e o receptor reconstrói o
arquivo a partir de **quaisquer ~K·1.05 frames distintos**, em qualquer ordem
(*peeling* + eliminação gaussiana). Frames perdidos custam tempo, nunca correção.

```mermaid
flowchart LR
  A[Arquivo] --> B[Container<br/>gzip + SHA-256]
  B --> C[Fountain LT<br/>K blocos]
  C --> D[QR byte-mode<br/>1-4 por quadro]
  D -->|luz| E[Câmera]
  E --> F[zxing-wasm<br/>workers]
  F --> G[Peeling +<br/>eliminação gaussiana]
  G --> H[Verifica SHA-256]
  H --> I[Arquivo idêntico]
```

## Arquitetura (4 camadas ortogonais)

| Camada | Responsabilidade | Onde |
|---|---|---|
| Container | nome/tipo do arquivo, gzip quando ajuda, SHA-256 | [container.ts](app/shared/container.ts) |
| Fountain (rateless) | apagadura: reconstrói de qualquer ~K·1.05 frames | [fountain.ts](app/shared/fountain.ts) |
| PatternCodec | modulação visual plugável (QR hoje; cor/densa planejadas) | [pattern-codec.ts](app/shared/pattern-codec.ts) |
| Cripto (AEAD) | confidencialidade por palavra-chave | _(planejado — [ADR 0004](docs/decisions/0004-security-passphrase-aead.md))_ |

- **Emissor** ([send/main.ts](app/send/main.ts)): arquivo → container → fountain → QR animado.
- **Receptor** ([receive/main.ts](app/receive/main.ts)): câmera → **zxing-wasm** → fountain → download.
- **Decoder**: o app usa **zxing-wasm** (rápido/robusto, offline); o `jsQR` fica como
  decoder de referência dos testes (ver [ADR 0005](docs/decisions/0005-zxing-wasm-decoder.md)).

---

## Rodar na máquina (PC = transmissor)

Pré-requisitos: **Node 22+** e npm.

```powershell
npm install
npm run dev
```

Abra **http://localhost:5173/send/** no PC. Escolha um arquivo, clique em
**Transmitir** e depois em **⛶ Tela cheia** (QR grande = a câmera foca melhor).

> O PC é o transmissor ideal (tela grande e estável); o receptor é o celular.

## Rodar no celular (celular = receptor)

A câmera (`getUserMedia`) **só funciona em HTTPS** fora de `localhost`. Um IP de
LAN em HTTP (`http://192.168.x.x:5173`) **não** abre a câmera. Publique o site (HTTPS
com URL fixa, sem túnel) ou use um túnel HTTPS para o dev server:

### Opção 0 — site publicado na Vercel (URL fixa, sem túnel)

O [vercel.json](vercel.json) publica dois services no mesmo projeto: `app` (o site
estático do `vite build`, em `/`) e `diagnostics` (a função
[api/diagnostics.ts](api/diagnostics.ts), só em `/api/diagnostics`), que guarda os
relatórios num Blob privado. O `analysis/` não vai para a Vercel. Uma vez só:

1. Vercel → **Add New → Project** → importe este repositório do GitHub e confira que o
   *Framework Preset* ficou **Services** (vem do `vercel.json`).
2. No projeto: **Storage → Create → Blob → Private** e conecte ao projeto (a função
   autentica sozinha, via OIDC).
3. **Settings → Environment Variables**: `DIAGNOSTICS_KEY` = um segredo longo
   (`openssl rand -hex 16`) e faça *Redeploy*. Sem ela o coletor fica fechado.
4. Em cada aparelho, abra uma vez a página com a chave — ela fica guardada no
   navegador e sai da barra de endereço:
   `https://<projeto>.vercel.app/receive/?key=<segredo>` (e `/send/?key=…` no PC).
5. Para trazer os relatórios: crie `.env.local` (fora do git) com
   `FAROL_URL=https://<projeto>.vercel.app` e `FAROL_KEY=<segredo>`, e rode
   `npm run reports:pull` — eles caem em `analysis/reports/`.

Cada `git push` na `main` publica de novo. Sem a chave o site funciona igual, mas o
relatório é baixado no celular. Para rodar os dois services juntos na máquina:
`npx vercel dev --local` (ali o `/api/diagnostics` é o coletor do Vite, que grava em
`analysis/reports/`, não o Blob).

### Opção A — túnel Cloudflare (rápido, sem login)

```powershell
winget install --id Cloudflare.cloudflared     # Windows, só na primeira vez
brew install cloudflared                       # macOS, só na primeira vez
cloudflared tunnel --url http://localhost:5173
```

Copie o endereço gerado (`https://<algo>.trycloudflare.com`) e, no celular, abra
`https://<algo>.trycloudflare.com/receive/`.

### Opção B — VS Code Port Forwarding

Painel **Ports** → **Forward a Port** → `5173` → botão direito → **Port
Visibility: Public**. Use o endereço `https://…devtunnels.ms/receive/` no celular.

> `allowedHosts: true` em [vite.config.ts](vite.config.ts) já aceita os hosts do
> túnel. O arquivo **não** passa pelo túnel — ele só entrega a página ao celular;
> a transferência acontece pela **luz** (tela → câmera).

### Testar a transferência

1. **Celular** → abra `.../receive/` → **Iniciar câmera** (a melhor lente traseira
   é escolhida automaticamente) → aponte para a tela do PC a **~25–30 cm**.
2. **PC** → `/send/` → escolha o arquivo → **Transmitir** → **⛶ Tela cheia**.
3. O celular mostra telemetria ao vivo (`câmera fps → códigos/s • catch % • KB/s • ETA`;
   *catch* = parte dos códigos exibidos que o receptor conseguiu ler).
   Ao chegar a 100%: **"SHA-256 OK"** e o botão de download.

---

## Ajuste fino (painel do `/send/`)

Valores padrão seguem o decimen; ajuste conforme sua câmera/tela.

| Controle | Padrão | Efeito |
|---|---|---|
| **fps** | 24 | Alvo; cada quadro fica um número **inteiro** de refreshes (60 Hz ÷ 3 = 20 fps efetivos) — sem cadência 2-3-2-3. |
| **densidade** | QR v27 | Versão do QR; a capacidade (B/código) depende do ECC e aparece no rótulo. |
| **ECC** | L | O fountain cobre frames perdidos; o ECC do QR cobre corrupção interna. |
| **códigos por quadro** | 1 | 2 (lado a lado) ou 4 (grade 2×2): cada código é um frame independente — multiplica os bytes por quadro se a câmera ainda resolver os módulos. |

**Se travar em 0% ou baixa %** (frames borrados): use **Tela cheia**, **afaste**
o celular, aumente o **brilho** da tela, mantenha o aparelho **estável** e, se
preciso, **baixe a densidade** (v20 ou v15) ou volte para 1 código por quadro. É o
trade-off velocidade × nitidez.

## Diagnóstico automático

O `/receive/` envia o relatório de cada transferência para `/api/diagnostics`, já
mesclado com o que o `/send/` anunciou (versão do QR, ECC, códigos, fps alvo/efetivo,
refresh, travamentos da aba do emissor):

- **`npm run dev`** (inclusive pelo túnel): o plugin do Vite salva direto em
  `analysis/reports/` e mostra uma linha por evento no terminal.
- **Site publicado**: a função guarda no Blob privado (só com a chave, veja a Opção 0)
  e `npm run reports:pull` baixa para `analysis/reports/`.
- Sem coletor (site publicado sem a chave), o JSON é baixado no celular.

## Scripts

```powershell
npm run dev        # servidor de desenvolvimento (Vite, porta 5173)
npm run build      # build de produção → dist/
npm run preview    # serve o build de produção
npm test           # vitest (42 testes: vetores-ouro, fountain + eliminação, sessão, e2e QR/zxing)
npm run typecheck  # tsc --noEmit
```

## Documentação

- Protocolo de fio: [docs/protocol.md](docs/protocol.md)
- Análise dos relatórios e roteiro de testes: [docs/ROTEIRO-TESTES.md](docs/ROTEIRO-TESTES.md)
- Decisões de arquitetura: [docs/decisions/](docs/decisions/)
- Diário de aprendizado: [docs/DEVLOG.md](docs/DEVLOG.md)
- Roadmap (próximos passos): [docs/ROADMAP.md](docs/ROADMAP.md)

## Referências

- [decimen](https://github.com/bashalarmistalt/decimen-optical-transfer) — QR animado +
  fountain (mesma arquitetura; 418 KB/s medidos desktop→phone). AGPL-3.0: usado como
  referência de **ideias e medições** (ver ADR 0003 e DEVLOG), sem código copiado.
- [libcimbar](https://github.com/sz3/libcimbar) — barcodes de cor, ~106 KB/s
  (estado da arte; direção do futuro `PatternCodec` de cor).
- [divan/txqr](https://github.com/divan/txqr) — QR animado + fountain em Go, com
  ótimos artigos sobre por que fountain vence o loop sequencial.
