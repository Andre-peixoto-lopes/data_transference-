const toggle = document.createElement("button");
toggle.type = "button";
toggle.className = "theme-toggle secondary";
document.querySelector(".site-header")!.append(toggle);
const icons = {
  dark: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
};

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro";
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  toggle.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[theme]}</svg>`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f6fa" : "#191b1a");
}
applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
toggle.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try { localStorage.setItem("farol:theme", theme); } catch { /* Works for this page without storage. */ }
});
