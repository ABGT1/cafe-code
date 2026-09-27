import type { DesktopBridge } from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const originalDesktopBridge = window.desktopBridge;
const originalTheme = localStorage.getItem("cafe-code:theme");
const originalDocumentClass = document.documentElement.className;
const originalDocumentStyle = document.documentElement.getAttribute("style");
const originalBodyStyle = document.body.getAttribute("style");
const originalDynamicThemeColor = document.querySelector<HTMLMetaElement>(
  'meta[name="theme-color"][data-dynamic-theme-color="true"]',
);
const originalDynamicThemeColorContent = originalDynamicThemeColor?.content;

beforeEach(() => {
  // Module initialization is the failure boundary: the auxiliary window can
  // import theme code before React mounts its ready-handshake effect.
  localStorage.setItem("cafe-code:theme", "dark");
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  if (originalDesktopBridge === undefined) {
    Reflect.deleteProperty(window, "desktopBridge");
  } else {
    window.desktopBridge = originalDesktopBridge;
  }
  if (originalTheme === null) {
    localStorage.removeItem("cafe-code:theme");
  } else {
    localStorage.setItem("cafe-code:theme", originalTheme);
  }
  document.documentElement.className = originalDocumentClass;
  for (const [element, style] of [
    [document.documentElement, originalDocumentStyle],
    [document.body, originalBodyStyle],
  ] as const) {
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
  }
  const dynamicThemeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"][data-dynamic-theme-color="true"]',
  );
  if (originalDynamicThemeColor === null) {
    dynamicThemeColor?.remove();
  } else if (originalDynamicThemeColorContent !== undefined) {
    originalDynamicThemeColor.content = originalDynamicThemeColorContent;
  }
  vi.restoreAllMocks();
});

describe("theme initialization in desktop renderers", () => {
  it("loads with the restricted dictation bridge without requiring native theme authority", async () => {
    // Match the panel preload's capability surface. Adding setTheme here
    // would hide the production boot failure and weaken the regression.
    const panelBridge = {
      getLocalEnvironmentBootstrap: vi.fn(() => null),
      onGlobalDictationEvent: vi.fn(() => () => undefined),
      globalDictationAction: vi.fn(async () => ({ ok: true })),
    } satisfies Pick<
      DesktopBridge,
      "getLocalEnvironmentBootstrap" | "onGlobalDictationEvent" | "globalDictationAction"
    >;
    window.desktopBridge = panelBridge as unknown as DesktopBridge;

    const theme = await import("../hooks/useTheme");

    expect(theme.useTheme).toBeTypeOf("function");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(panelBridge.getLocalEnvironmentBootstrap).not.toHaveBeenCalled();
    expect(panelBridge.onGlobalDictationEvent).not.toHaveBeenCalled();
    expect(panelBridge.globalDictationAction).not.toHaveBeenCalled();
    expect(window.desktopBridge).not.toHaveProperty("setTheme");
  });

  it("still synchronizes a normal desktop renderer's native theme", async () => {
    const setTheme = vi.fn(async () => undefined);
    window.desktopBridge = { setTheme } as unknown as DesktopBridge;

    const { useTheme } = await import("../hooks/useTheme");
    function ThemeProbe() {
      useTheme();
      return null;
    }
    const screen = await render(<ThemeProbe />);
    try {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(setTheme).toHaveBeenCalledExactlyOnceWith("dark");
    } finally {
      await screen.unmount();
    }
  });
});
