(() => {
  const storageKey = "codex-scheduler-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => {
    let storedTheme = null;
    try {
      storedTheme = window.localStorage.getItem(storageKey);
    } catch {
      // Use the operating-system preference when storage is unavailable.
    }

    const dark =
      storedTheme === "dark" || (storedTheme !== "light" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };

  const runtime = Object.freeze({ applyTheme, media });
  Object.defineProperty(window, "__CLOCKHAND_THEME__", {
    configurable: true,
    value: runtime,
  });
  applyTheme();
})();
