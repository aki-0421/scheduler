import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInThisContext } from "node:vm";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "@/app/providers";

const themeInitSource = readFileSync(
  join(process.cwd(), "public", "theme-init.js"),
  "utf8",
);

function installMediaPreference(initialDark: boolean) {
  const media = {
    matches: initialDark,
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

  return {
    media,
    change(dark: boolean) {
      Object.defineProperty(media, "matches", {
        configurable: true,
        value: dark,
      });
      const event = { matches: dark, media: media.media } as MediaQueryListEvent;
      for (const [type, listener] of media.addEventListener.mock.calls) {
        if (type !== "change") {
          continue;
        }
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
  };
}

function installStorage(
  getItemOverride?: (key: string) => string | null,
) {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: vi.fn((key: string) =>
      getItemOverride ? getItemOverride(key) : (values.get(key) ?? null),
    ),
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } satisfies Storage;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

function executeThemeInit() {
  runInThisContext(themeInitSource);
  expect(window.__CLOCKHAND_THEME__).toBeDefined();
}

function renderProviders() {
  return render(
    <Providers>
      <main>Clockhand</main>
    </Providers>,
  );
}

describe("Providers theme integration", () => {
  beforeEach(() => {
    installStorage();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    Reflect.deleteProperty(window, "__CLOCKHAND_THEME__");
  });

  it("updates the root class and color scheme after an OS theme change", () => {
    const media = installMediaPreference(false);
    executeThemeInit();
    renderProviders();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");

    act(() => media.change(true));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("does not follow OS changes while a stored override exists", () => {
    const storage = installStorage();
    storage.setItem("codex-scheduler-theme", "light");
    const media = installMediaPreference(false);
    executeThemeInit();
    renderProviders();

    act(() => media.change(true));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("removes the same OS listener when Providers unmounts", () => {
    const { media } = installMediaPreference(false);
    executeThemeInit();
    const view = renderProviders();
    const listener = media.addEventListener.mock.calls.find(
      ([type]) => type === "change",
    )?.[1];

    expect(listener).toBeDefined();
    view.unmount();

    expect(media.removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("falls back to the OS theme when storage throws", () => {
    installStorage(() => {
      throw new Error("storage is unavailable");
    });
    installMediaPreference(true);

    expect(() => renderProviders()).not.toThrow();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("treats an invalid stored value as an OS-controlled theme", () => {
    installStorage(() => "sepia");
    const media = installMediaPreference(false);
    renderProviders();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");

    act(() => media.change(true));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
