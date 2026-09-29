import "../index.css";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyCafeBackgroundAnimations,
  CAFE_BACKGROUND_ANIMATIONS_ATTRIBUTE,
  CAFE_DOCUMENT_VISIBILITY_ATTRIBUTE,
  CAFE_WINDOW_FOCUS_ATTRIBUTE,
} from "../documentVisibility";

const attributes = [
  CAFE_BACKGROUND_ANIMATIONS_ATTRIBUTE,
  CAFE_DOCUMENT_VISIBILITY_ATTRIBUTE,
  CAFE_WINDOW_FOCUS_ATTRIBUTE,
];
let savedAttributes: (string | null)[];
let host: HTMLDivElement;

beforeEach(() => {
  savedAttributes = attributes.map((name) => document.documentElement.getAttribute(name));
  host = document.createElement("div");
  document.body.append(host);
  setState(false, "visible", "focused");
});

afterEach(() => {
  host.remove();
  attributes.forEach((name, index) => {
    const value = savedAttributes[index];
    if (value == null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  });
});

function setState(background: boolean, visibility: string, focus: string) {
  applyCafeBackgroundAnimations(background);
  document.documentElement.setAttribute(CAFE_DOCUMENT_VISIBILITY_ATTRIBUTE, visibility);
  document.documentElement.setAttribute(CAFE_WINDOW_FOCUS_ATTRIBUTE, focus);
}

function indicator(className: string) {
  const element = document.createElement("div");
  element.className = className;
  element.style.width = "40px";
  element.style.height = "40px";
  host.append(element);
  return element;
}

describe("status animation frame budgets", () => {
  it.each([
    ["animate-spin", "transform"],
    ["animate-spin [--cafe-spin-duration:5s] [--cafe-spin-steps:300]", "transform"],
    ["animate-pulse", "opacity"],
    ["animate-ping", "transform"],
    ["animate-bounce", "transform"],
    ["animate-bounce [--cafe-bounce-duration:2.4s] [--cafe-bounce-steps:72]", "transform"],
    ["animate-skeleton", "backgroundPosition"],
  ] as const)("bounds %s to 60 visual changes/second at 500 Hz", (className, property) => {
    const element = indicator(className);
    const animation = element.getAnimations()[0];
    expect(animation).toBeDefined();
    if (!animation) throw new Error("Missing status animation");
    expect(animation.effect?.getTiming().iterations).toBe(Infinity);
    animation.pause();

    // Advance the actual browser animation at a simulated 500 Hz. Checking
    // sampled pixels' input properties catches keyframe easing overriding the
    // cap, or a duration override silently increasing the number of updates.
    let previous: string | undefined;
    let changes = 0;
    for (let time = 0.25; time < 1_000; time += 2) {
      animation.currentTime = time;
      const value = getComputedStyle(element)[property];
      if (previous !== undefined && value !== previous) changes++;
      previous = value;
    }
    expect(changes).toBeGreaterThan(10);
    expect(changes).toBeLessThanOrEqual(60);
  });

  it.each([
    [false, "visible", "focused", "running", "running"],
    [false, "visible", "blurred", "running", "paused"],
    [false, "hidden", "focused", "paused", "paused"],
    [false, "hidden", "blurred", "paused", "paused"],
    [true, "visible", "blurred", "running", "running"],
    [true, "hidden", "blurred", "running", "running"],
  ] as const)(
    "respects background=%s, visibility=%s, focus=%s",
    (background, visibility, focus, statusState, decorationState) => {
      setState(background, visibility, focus);
      // Mount after entering the background state, as live provider updates do.
      for (const name of ["spin", "pulse", "ping", "bounce", "skeleton"]) {
        const element = indicator(`animate-${name}`);
        expect(getComputedStyle(element).animationPlayState).toBe(statusState);
      }
      host.dataset.type = "loading";
      const toastSpinner = indicator("in-data-[type=loading]:animate-spin");
      expect(getComputedStyle(toastSpinner).animationName).toBe("spin");
      expect(getComputedStyle(toastSpinner).animationPlayState).toBe(statusState);
      for (const name of ["frame", "chroma", "pill", "word"]) {
        const element = indicator(`ultrathink-${name}`);
        expect(getComputedStyle(element).animationPlayState).toBe(decorationState);
      }
      const finiteAnimation = indicator("cafe-onboarding");
      expect(getComputedStyle(finiteAnimation).animationName).toBe("cafe-onboarding-surface-in");
      expect(getComputedStyle(finiteAnimation).animationPlayState).toBe("running");
      expect(getComputedStyle(finiteAnimation).animationIterationCount).toBe("1");
    },
  );

  it("resumes the same status animation after a hidden document becomes visible", async () => {
    const element = indicator("animate-spin");
    const animation = element.getAnimations()[0]!;
    setState(false, "hidden", "blurred");
    await expect.poll(() => animation.playState).toBe("paused");
    const pausedTime = animation.currentTime;
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(animation.currentTime).toBe(pausedTime);

    setState(false, "visible", "blurred");
    expect(element.getAnimations()[0]).toBe(animation);
    await expect.poll(() => animation.playState).toBe("running");
    await expect.poll(() => Number(animation.currentTime)).toBeGreaterThan(Number(pausedTime));
  });
});
