# 5. Decoder de câmera: zxing-wasm (jsQR fica como decoder de referência)

- Status: aceito
- Data: 2026-09-27

## Contexto
O gargalo real de throughput tela→câmera não é a densidade do QR nem o fps: é
**quantos frames capturados o receptor consegue decodificar por segundo**. O
`jsQR` (JS puro) roda na main thread, é single-thread e é lento e menos robusto
que decoders nativos. O projeto de referência (decimen) decodifica com
**zxing-wasm** — a mesma conclusão a que chegamos medindo BER/goodput.

Parâmetros medidos do decimen que adotamos: **24 fps**, **~1465 bytes/frame (QR
v27)**, **ECC L**, overhead de fountain **~K·1.15**.

## Decisão
- A página de câmera (`/receive/`) decodifica com **zxing-wasm** (WebAssembly,
  rápido e robusto; funciona inclusive em Safari/iOS, sem `BarcodeDetector`).
- O `.wasm` é servido do **próprio origin** (import `?url` do Vite), então o
  receptor continua funcionando offline.
- O `QrCodec.decode` (jsQR) permanece como **decoder de referência**: síncrono,
  sem WASM, roda em Node — é o que os testes unit/e2e e o demo loopback usam.
- O `Receiver` ganhou `offerBytes(frameBytes)` para receber bytes já decodificados
  por um leitor externo, mantendo `offer(image)` para o caminho com codec.

## Consequências
- O caminho de decode do app vira **assíncrono** (o `readBarcodes` retorna
  `Promise`); o loop de captura serializa um decode por vez com
  `requestVideoFrameCallback`.
- Dois decoders coexistem por um bom motivo: jsQR é o oráculo determinístico dos
  testes; zxing-wasm é o motor de produção. Ambos leem o mesmo QR byte-mode.
- Evolução natural (decimen): mover o decode para **Web Workers** (um pool) para
  processar vários frames em paralelo quando o decode virar o gargalo.
