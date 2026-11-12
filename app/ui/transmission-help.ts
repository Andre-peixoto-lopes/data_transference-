export const transmissionHelp = `
  <h1>Entenda os parâmetros de transmissão</h1>
  <p class="doc-lead">Os quatro parâmetros controlam a frequência de troca dos QR codes, a quantidade de dados em cada código e a facilidade de leitura pela câmera. A velocidade da transferência depende dessa combinação e de quantos códigos o receptor consegue aproveitar.</p>

  <h2>Quadros por segundo — FPS</h2>
  <p>Define quantas vezes por segundo a tela troca os QR codes. O campo aceita valores de 1 a 60 e começa em 24.</p>
  <p>Com menos quadros por segundo, cada imagem fica visível por mais tempo e a câmera tem mais oportunidades de capturá-la. Com mais quadros, o transmissor apresenta mais dados por segundo, mas exige que a câmera e o celular acompanhem as mudanças.</p>
  <p>O Farol ajusta a taxa à frequência da tela para manter cada quadro pelo mesmo número de atualizações. Em uma tela de 60 Hz, os valores abaixo resultam nas seguintes taxas calculadas.</p>
  <div class="parameter-table"><table>
    <caption>Ajuste de FPS em uma tela de 60 Hz</caption>
    <thead><tr><th scope="col">FPS solicitado</th><th scope="col">FPS calculado</th></tr></thead>
    <tbody><tr><td>10</td><td>10</td></tr><tr><td>15</td><td>15</td></tr><tr><td>20</td><td>20</td></tr><tr><td>24</td><td>20</td></tr><tr><td>30</td><td>30</td></tr><tr><td>60</td><td>60</td></tr></tbody>
  </table></div>
  <p>O status mostra a taxa calculada. O desempenho do dispositivo também pode afetar a apresentação dos quadros.</p>

  <h2>Densidade do QR code</h2>
  <p>Cada opção corresponde a uma versão do QR. Versões maiores têm mais quadradinhos e transportam mais dados por código. Na mesma área de tela, esses quadradinhos ficam menores e exigem mais definição e foco da câmera. Versões menores carregam menos dados e têm quadradinhos maiores.</p>
  <p>A opção “QR v27 · 1465 B”, por exemplo, indica a versão 27 e a capacidade de 1.465 bytes por código. O valor em bytes acompanha o nível de correção de erros selecionado. A versão inicial é a v27.</p>
  <div class="parameter-table"><table>
    <caption>Capacidade por QR, em bytes</caption>
    <thead><tr><th scope="col">Versão</th><th scope="col">L</th><th scope="col">M</th><th scope="col">Q</th><th scope="col">H</th></tr></thead>
    <tbody>
      <tr><th scope="row">v10</th><td>271</td><td>213</td><td>151</td><td>119</td></tr>
      <tr><th scope="row">v15</th><td>520</td><td>412</td><td>292</td><td>220</td></tr>
      <tr><th scope="row">v20</th><td>858</td><td>666</td><td>482</td><td>382</td></tr>
      <tr><th scope="row">v25</th><td>1.273</td><td>997</td><td>715</td><td>535</td></tr>
      <tr><th scope="row">v27</th><td>1.465</td><td>1.125</td><td>805</td><td>625</td></tr>
      <tr><th scope="row">v30</th><td>1.732</td><td>1.370</td><td>982</td><td>742</td></tr>
      <tr><th scope="row">v33</th><td>2.068</td><td>1.628</td><td>1.168</td><td>898</td></tr>
      <tr><th scope="row">v36</th><td>2.431</td><td>1.911</td><td>1.351</td><td>1.051</td></tr>
      <tr><th scope="row">v40</th><td>2.953</td><td>2.331</td><td>1.663</td><td>1.273</td></tr>
    </tbody>
  </table></div>
  <p>Em cada código, 24 bytes são usados pelo cabeçalho do protocolo. No v27 com correção L, sobram 1.441 bytes para o símbolo que transporta os dados do arquivo.</p>

  <h2>Correção de erros</h2>
  <p>Acrescenta redundância dentro de cada QR para recuperar informações quando partes dele são lidas com erros. Aumentar a correção reduz a quantidade de dados que cabe na mesma versão de QR.</p>
  <div class="parameter-table"><table>
    <caption>Níveis de correção disponíveis</caption>
    <thead><tr><th scope="col">Opção</th><th scope="col">Efeito</th></tr></thead>
    <tbody>
      <tr><th scope="row">L — mais rápido</th><td>Menor redundância e maior capacidade de dados por QR. É o nível inicial.</td></tr>
      <tr><th scope="row">M — intermediário</th><td>Aumenta a correção e reduz a capacidade disponível.</td></tr>
      <tr><th scope="row">Q — alta correção</th><td>Reserva mais espaço para recuperar erros de leitura.</td></tr>
      <tr><th scope="row">H — mais robusto</th><td>Maior correção disponível e menor capacidade de dados por QR.</td></tr>
    </tbody>
  </table></div>
  <p>A indicação “mais rápido” do nível L se refere à maior capacidade por código. A velocidade final depende das leituras bem-sucedidas. Uma configuração que transporta muitos dados pode demorar mais se a câmera falhar frequentemente.</p>
  <p>O Farol também usa códigos fountain para reconstruir o arquivo quando alguns códigos da sequência deixam de ser capturados. Essa proteção complementa a correção de erros de cada QR.</p>

  <h2>Códigos por quadro</h2>
  <p>Define quantos QR codes aparecem simultaneamente. Cada código carrega um símbolo diferente da transferência.</p>
  <div class="parameter-table"><table>
    <caption>Quantidade e disposição dos códigos</caption>
    <thead><tr><th scope="col">Opção</th><th scope="col">Efeito</th></tr></thead>
    <tbody>
      <tr><th scope="row">1 código</th><td>Um QR por quadro, com mais área disponível para ele. É a opção inicial.</td></tr>
      <tr><th scope="row">2 — lado a lado</th><td>Dois QRs com dados diferentes, permitindo transportar dois símbolos por quadro.</td></tr>
      <tr><th scope="row">4 — grade 2 × 2</th><td>Quatro QRs com dados diferentes, permitindo transportar quatro símbolos por quadro.</td></tr>
    </tbody>
  </table></div>
  <p>Com mais códigos, cada um ocupa menos espaço na tela e o receptor precisa processar mais leituras. A câmera precisa enquadrar todos os códigos. A 20 FPS com quatro códigos, por exemplo, são apresentados 80 QR codes por segundo. O ganho real depende de quantos são decodificados.</p>
  <p class="doc-callout">Configure os parâmetros antes de iniciar. Para aplicar alterações durante um envio, clique novamente em Transmitir arquivo.</p>
`;
