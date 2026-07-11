import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInThisContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

const themeInitSource = readFileSync(
  join(process.cwd(), "public", "theme-init.js"),
  "utf8",
);

type ThemeRuntime = {
  applyTheme: () => void;
  media: MediaQueryList;
};

const themeWindow = window as Window & {
  __CLOCKHAND_THEME__?: ThemeRuntime;
};

function installMediaPreference(dark: boolean) {
  const media = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => media),
  });
  return media;
}

function installStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function executeThemeInit() {
  runInThisContext(themeInitSource);
  return themeWindow.__CLOCKHAND_THEME__;
}

describe("pre-paint theme initialization", () => {
  beforeEach(() => {
    installStorage();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    Reflect.deleteProperty(themeWindow, "__CLOCKHAND_THEME__");
  });

  it("applies the operating-system dark theme immediately", () => {
    installMediaPreference(true);

    expect(executeThemeInit()).toBeDefined();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("keeps the light theme for a light operating-system preference", () => {
    installMediaPreference(false);

    executeThemeInit();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it.each([
    ["light", true, false],
    ["dark", false, true],
  ])(
    "gives a stored %s preference precedence over the operating system",
    (storedTheme, systemDark, expectedDark) => {
      installMediaPreference(systemDark);
      window.localStorage.setItem("codex-scheduler-theme", storedTheme);

      const runtime = executeThemeInit();
      runtime?.applyTheme();

      expect(document.documentElement.classList.contains("dark")).toBe(
        expectedDark,
      );
      expect(document.documentElement.style.colorScheme).toBe(
        expectedDark ? "dark" : "light",
      );
    },
  );
});
