// Apply the saved appearance before the page paints. Dark remains the default.
try {
  document.documentElement.dataset.theme = localStorage.getItem("farol:theme") === "light" ? "light" : "dark";
} catch { document.documentElement.dataset.theme = "dark"; }
