import { examples } from "./examples.js";
import { clearHistory, transferHistory, type TransferKind } from "./history.js";
import { historyFiles } from "./history-files.js";
import { saveFile } from "../shared/save-file.js";

const symbols: Record<string, string> = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  logic: '<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v5M5 13h14M5 13v3m14-3v3"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/>',
  example: '<path d="m9 3-1 7-4 8a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-4-8-1-7M8 3h8M7 14h10"/>',
  send: '<path d="M12 17V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  receive: '<path d="M12 3v14m-5-5 5 5 5-5M4 15v6h16v-6"/>',
};
function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${symbols[name]}</svg>`;
}
const labels: Record<TransferKind, string> = {
  send: "Envio iniciado", receive: "Recepção verificada", "demo-send": "Envio simulado", "demo-receive": "Recepção simulada",
};
const header = document.querySelector<HTMLElement>(".site-header")!;
header.insertAdjacentHTML("afterbegin", `<button class="sidebar-toggle secondary" aria-label="Abrir barra lateral" aria-expanded="false" aria-controls="sidebar">${icon("menu")}</button>`);
document.body.insertAdjacentHTML("beforeend", `
  <div class="sidebar-backdrop" hidden></div>
  <aside id="sidebar" class="sidebar" aria-label="Documentação e histórico" inert>
    <div class="sidebar-top"><a class="brand" href="/"><img src="/favicon.svg" alt=""/>Farol</a><button class="sidebar-close secondary" aria-label="Ocultar barra lateral">${icon("close")}</button></div>
    <p class="sidebar-label">Documentação</p>
    <nav class="sidebar-nav" aria-label="Documentação">
      <button data-view="introduction">${icon("book")}Introdução</button>
      <button data-view="how">${icon("logic")}Como funciona</button>
      <button data-view="examples">${icon("example")}Arquivos para teste</button>
    </nav>
    <div class="history-heading"><p class="sidebar-label">Histórico</p><button class="clear-history" hidden>Limpar histórico</button></div>
    <p class="clear-history-feedback hint" role="status" hidden></p>
    <div class="history-list" aria-label="Histórico de transferências"></div>
  </aside>
  <dialog class="history-dialog" aria-labelledby="history-title"><form method="dialog"><button class="secondary" aria-label="Fechar detalhes">${icon("close")}</button></form><div class="eyebrow">Histórico</div><h2 id="history-title">Detalhes da transferência</h2><div class="history-detail"></div></dialog>
`);
const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
const toggle = document.querySelector<HTMLButtonElement>(".sidebar-toggle")!;
const backdrop = document.querySelector<HTMLElement>(".sidebar-backdrop")!;
const mobile = window.matchMedia("(max-width: 1023px)");
const original = document.querySelector<HTMLElement>("main")!;
const docs = document.createElement("main");
docs.className = "page documentation-page";
docs.hidden = true;
original.after(docs);
let lockedScrollY: number | undefined;
function setOpen(open: boolean, returnFocus = false): void {
  if (open && mobile.matches && lockedScrollY === undefined) {
    lockedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.width = "100%";
  } else if ((!open || !mobile.matches) && lockedScrollY !== undefined) {
    const scrollY = lockedScrollY;
    lockedScrollY = undefined;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollY);
  }
  document.body.classList.toggle("sidebar-open", open);
  sidebar.inert = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Ocultar barra lateral" : "Abrir barra lateral");
  backdrop.hidden = !(open && mobile.matches);
  for (const element of document.querySelectorAll<HTMLElement>("main, .site-footer, .navigation, .site-header > .brand, .local-badge, .theme-toggle")) element.inert = open && mobile.matches;
  if (returnFocus) toggle.focus({ preventScroll: true });
  if (open && mobile.matches) sidebar.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
  window.dispatchEvent(new Event("resize"));
}
toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("sidebar-open")));
document.querySelector(".sidebar-close")!.addEventListener("click", () => setOpen(false, true));
backdrop.addEventListener("click", () => setOpen(false, true));
document.addEventListener("keydown", (event) => {
  if (!document.body.classList.contains("sidebar-open")) return;
  if (event.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false, true);
  if (event.key === "Tab" && mobile.matches && !document.querySelector("dialog[open]")) {
    const focusable = [toggle, ...sidebar.querySelectorAll<HTMLElement>("a, button:not([disabled])")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
mobile.addEventListener("change", () => setOpen(!mobile.matches));
setOpen(!mobile.matches);

const introduction = `
  <div class="eyebrow">Orientações de uso</div><h1>Introdução ao protótipo</h1>
  <p class="doc-lead">O Farol transforma um arquivo em QR codes animados. Outro dispositivo lê esses códigos pela câmera e reconstrói o arquivo original.</p>
  <div class="doc-callout">O ensaio de transferência utiliza dois dispositivos: um com tela para transmissão e outro com câmera para recepção. Após o carregamento da aplicação, o conteúdo do arquivo é transmitido pelo canal óptico, sem depender de Wi-Fi, Bluetooth ou cabo para esse transporte.</div>
  <h2>Procedimento de transferência</h2><ol class="doc-steps">
    <li><h3>Abra o transmissor</h3><p>No computador ou dispositivo de origem, entre em Transmitir e escolha seu arquivo. Você também pode selecionar um arquivo na seção Arquivos para teste.</p></li>
    <li><h3>Comece a transmitir</h3><p>Clique em Transmitir arquivo. A tela exibirá uma sequência de QR codes. Use Tela cheia para facilitar a leitura e mantenha a aba visível.</p></li>
    <li><h3>Abra o receptor</h3><p>No outro dispositivo, entre em Receber, toque em Iniciar câmera e autorize o acesso. No navegador, use HTTPS ou localhost.</p></li>
    <li><h3>Enquadre e aguarde</h3><p>Aponte para a tela inteira do código. Evite reflexos, ajuste a distância e mantenha os dispositivos estáveis enquanto a barra de progresso avança.</p></li>
    <li><h3>Verifique e salve</h3><p>O Farol reconstrói o arquivo e confere sua integridade com SHA-256. Quando a verificação terminar, clique em Baixar arquivo.</p></li>
  </ol><div class="doc-actions"><a class="button" href="/send/">Abrir transmissor</a><button class="secondary" data-view="examples">Consultar arquivos de teste</button></div>`;
const how = `
  <div class="eyebrow">Fundamentação técnica</div><h1>Etapas da transferência óptica</h1>
  <p class="doc-lead">O Farol organiza o arquivo em um container, divide seu conteúdo em blocos e transmite símbolos codificados em uma sequência de padrões ópticos. O receptor acumula esses símbolos para reconstruir o arquivo, tolerando a perda de quadros.</p>
  <div class="flow-line" aria-label="Etapas da transferência">Arquivo <span>→</span> Container <span>→</span> Blocos <span>→</span> QR animado <span>→</span> Câmera <span>→</span> Verificação</div>
  <ol class="doc-steps">
    <li><h3>Preparar o arquivo e sua identidade</h3><p>O transmissor lê os bytes e calcula o SHA-256 do conteúdo original. Nome, tipo, tamanho e hash são reunidos em um container. A compactação gzip só é usada quando diminui o tamanho; o receptor consegue desfazê-la depois.</p></li>
    <li><h3>Dividir e combinar blocos</h3><p>O container é dividido em blocos. Um código fountain LT gera combinações desses blocos usando XOR. Cada símbolo carrega informações para o receptor saber quais blocos foram combinados. Novos símbolos continuam sendo gerados enquanto a transmissão estiver ativa.</p></li>
    <li><h3>Transformar bytes em QR codes</h3><p>Cada QR leva um cabeçalho de protocolo e um símbolo fountain. O cabeçalho identifica a sessão, a sequência e os parâmetros da reconstrução. Você pode ajustar densidade, correção de erros, quadros por segundo e a quantidade de códigos por quadro.</p><p>A correção de erros do QR ajuda na leitura da imagem. O fountain lida com quadros que a câmera não conseguiu captar: são proteções em etapas diferentes.</p></li>
    <li><h3>Exibir e capturar pela luz</h3><p>O transmissor desenha a sequência na tela. A câmera do receptor captura as imagens, e processos de leitura usam zxing-wasm para decodificar os QR codes. Não há canal de retorno: o receptor não pede um quadro específico novamente.</p></li>
    <li><h3>Acumular informação e reconstruir</h3><p>O receptor identifica a sessão, ignora repetições e acumula os símbolos válidos. Ele usa peeling e eliminação gaussiana para resolver os blocos originais. Quadros perdidos podem aumentar o tempo necessário. O total de imagens para concluir varia conforme a informação recuperada.</p></li>
    <li><h3>Conferir o conteúdo original</h3><p>Com o container recuperado, o receptor descompacta o conteúdo, se necessário, e recalcula o SHA-256. O arquivo só é oferecido quando a verificação passa. Se houver falha, a recepção é reiniciada.</p></li>
    <li><h3>Salvar no dispositivo</h3><p>O botão Baixar arquivo entrega o conteúdo reconstruído. Pelo histórico lateral, você pode baixar o JSON da operação e baixar novamente imagens recebidas, inclusive após recarregar a página. Use Limpar histórico para apagar os registros e as imagens desta aba.</p></li>
  </ol><div class="doc-callout"><strong>Integridade não é criptografia.</strong> O SHA-256 detecta alterações no conteúdo. O fluxo óptico atual não usa senha nem criptografia: uma câmera que enxergue a transmissão pode tentar recebê-la.</div>
  <h2>Fatores que afetam o desempenho</h2><p>Foco, iluminação, reflexos, resolução da câmera, densidade do QR e taxa de quadros afetam a leitura. Recomenda-se iniciar com os parâmetros padrão e ajustar a distância para obter códigos nítidos. A simulação local usa uma grade óptica e lê os pixels diretamente; ela valida a reconstrução, mas não mede as condições reais de captura por câmera.</p>`;
function showView(view: string): void {
  const content = view === "introduction" ? introduction : view === "how" ? how : view === "examples" ? `
    <div class="eyebrow">Arquivos de referência</div><h1>Arquivos para teste</h1><p class="doc-lead">Arquivos pré-carregados para ensaios de transmissão e recepção entre dispositivos.</p>
    <div class="example-catalog"></div><div class="doc-callout">Os nomes originais são preservados na transmissão e no download. O arquivo original está disponível para comparação com o conteúdo recebido.</div><h2>Procedimento de recepção</h2><p>Selecione um arquivo de teste no transmissor. No segundo dispositivo, abra Receber e enquadre os QR codes exibidos na tela.</p>` : "";
  original.hidden = !!content;
  docs.hidden = !content;
  docs.innerHTML = content ? `<button class="doc-back secondary">← Voltar à ferramenta</button>${content}` : "";
  if (view === "examples") {
    const list = docs.querySelector(".example-catalog")!;
    for (const example of examples) {
      const card = document.createElement("article"); card.className = "example-card";
      const title = document.createElement("h2"); title.textContent = example.title;
      const desc = document.createElement("p"); desc.textContent = example.description;
      const link = document.createElement("a"); link.className = "button";
      link.href = `/send/?example=${encodeURIComponent(example.id)}`; link.textContent = "Usar no transmissor →";
      const actions = document.createElement("div"); actions.className = "doc-actions";
      actions.append(link);
      if (example.downloadUrl) {
        const download = document.createElement("a");
        download.className = "button secondary";
        download.href = example.downloadUrl;
        download.download = example.title;
        download.textContent = "Baixar original";
        download.setAttribute("aria-label", `Baixar ${example.title}`);
        actions.append(download);
      }
      card.append(title, desc, actions); list.append(card);
    }
  }
  for (const button of sidebar.querySelectorAll<HTMLElement>("[data-view]")) {
    if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  if (mobile.matches) setOpen(false);
  window.dispatchEvent(new Event("resize"));
  const focusTarget = content ? docs.querySelector<HTMLElement>("h1") : original.querySelector<HTMLElement>("h1");
  if (focusTarget) { focusTarget.tabIndex = -1; focusTarget.focus(); }
  window.scrollTo(0, 0);
}
document.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>("[data-view], .doc-back");
  if (target) showView(target.dataset.view ?? "");
});
const list = document.querySelector<HTMLElement>(".history-list")!;
const dialog = document.querySelector<HTMLDialogElement>(".history-dialog")!;
const clearButton = document.querySelector<HTMLButtonElement>(".clear-history")!;
const clearFeedback = document.querySelector<HTMLElement>(".clear-history-feedback")!;
let feedbackDelay: number | undefined;
let feedbackFade: number | undefined;
function hideClearFeedback(): void {
  window.clearTimeout(feedbackDelay);
  window.clearTimeout(feedbackFade);
  clearFeedback.hidden = true;
  clearFeedback.classList.remove("is-fading");
}
function showClearFeedback(message: string, autoDismiss = false): void {
  hideClearFeedback();
  clearFeedback.textContent = message;
  clearFeedback.hidden = false;
  if (autoDismiss) feedbackDelay = window.setTimeout(() => {
    clearFeedback.classList.add("is-fading");
    feedbackFade = window.setTimeout(hideClearFeedback, 500);
  }, 4000);
}
clearButton.addEventListener("click", async () => {
  hideClearFeedback();
  clearButton.disabled = true;
  try {
    await clearHistory();
    dialog.close();
    showClearFeedback("Histórico limpo.", true);
    document.querySelector<HTMLButtonElement>('[data-view="introduction"]')?.focus();
  } catch { showClearFeedback("Não foi possível limpar o histórico. Tente novamente."); }
  finally { clearButton.disabled = false; }
});
function renderHistory(): void {
  list.replaceChildren();
  const entries = transferHistory.list();
  clearButton.hidden = entries.length === 0;
  hideClearFeedback();
  if (!entries.length) {
    const empty = document.createElement("p"); empty.className = "history-empty";
    empty.textContent = "Nenhuma transferência registrada."; list.append(empty);
  }
  for (const entry of entries) {
    const button = document.createElement("button"); button.className = "history-entry";
    button.innerHTML = icon(entry.kind.includes("receive") ? "receive" : "send");
    const text = document.createElement("span");
    const name = document.createElement("strong"); name.textContent = entry.filename;
    const subtitle = document.createElement("small"); subtitle.textContent = `${labels[entry.kind]} · ${new Date(entry.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    text.append(name, subtitle); button.append(text);
    button.addEventListener("click", () => {
      const detail = document.querySelector(".history-detail")!; detail.replaceChildren();
      for (const value of [entry.filename, labels[entry.kind], `${entry.bytes.toLocaleString("pt-BR")} bytes`, new Date(entry.at).toLocaleString("pt-BR")]) {
        const p = document.createElement("p"); p.textContent = value; detail.append(p);
      }
      const p = document.createElement("p"); p.className = "hint";
      p.textContent = entry.kind.includes("send") ? "Registro do início da transmissão. O transmissor não recebe confirmação do outro dispositivo." : "Arquivo reconstruído e verificado com SHA-256.";
      detail.append(p);
      const actions = document.createElement("div"); actions.className = "doc-actions";
      const feedback = document.createElement("p"); feedback.className = "hint"; feedback.setAttribute("role", "status");
      const addDownload = (label: string, filename: string, load: () => Promise<Blob | undefined>): void => {
        const download = document.createElement("button"); download.textContent = label;
        download.addEventListener("click", async () => {
          download.disabled = true; feedback.textContent = "Preparando download…";
          try {
            const blob = await load();
            if (!blob) throw new Error("Esta imagem não está mais disponível. Faça uma nova recepção para baixá-la pelo histórico.");
            const location = await saveFile(blob, filename);
            feedback.textContent = location ? `Salvo em ${location}` : "Download solicitado.";
          } catch (error) { feedback.textContent = (error as Error).message; }
          finally { download.disabled = false; }
        });
        actions.append(download);
      };
      addDownload("Baixar JSON", `farol-${entry.kind}-${entry.at}.json`, async () => new Blob([
        JSON.stringify(entry.report ?? { kind: entry.kind, fileName: entry.filename, fileBytes: entry.bytes, startedAt: new Date(entry.at).toISOString() }, null, 2),
      ], { type: "application/json" }));
      if (entry.hasImage) addDownload("Baixar imagem recebida", entry.filename, () => historyFiles.get(entry.id));
      detail.append(actions, feedback); dialog.showModal();
    });
    list.append(button);
  }
}
window.addEventListener("farol:history", renderHistory);
// Re-render when navigating back from the browser's page cache.
window.addEventListener("pageshow", renderHistory);
renderHistory();
