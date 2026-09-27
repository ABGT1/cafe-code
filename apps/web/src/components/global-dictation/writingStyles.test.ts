import { describe, expect, it } from "vitest";
import { DICTATION_REWRITE_INSTRUCTIONS_MAX_CHARS } from "@cafecode/contracts";

import { applyLocalWritingStyle, parseOneShotVoiceCommand } from "./writingStyles";

describe("applyLocalWritingStyle", () => {
  it("preserves the exact original transcript for As transcribed", () => {
    const source = "  Hello, world!\nThe C++ code.  ";
    expect(applyLocalWritingStyle(source, "as-transcribed")).toBe(source);
  });

  it("lowercases Unicode without mutating the source", () => {
    const source = "CAFÉ, ΜΙΚΡΟ!\nİSTANBUL";
    expect(applyLocalWritingStyle(source, "lowercase")).toBe("café, μικρο!\ni̇stanbul");
    expect(source).toBe("CAFÉ, ΜΙΚΡΟ!\nİSTANBUL");
  });

  it("removes Unicode punctuation while retaining other characters", () => {
    expect(applyLocalWritingStyle("Hi—there! ‘Yes.’ 1.25 / foo_bar", "no-punctuation")).toBe(
      "Hithere Yes 125  foobar",
    );
  });

  it("supports combined lowercase and punctuation removal", () => {
    expect(applyLocalWritingStyle("HELLO, WORLD!", "lowercase-no-punctuation")).toBe("hello world");
  });

  it("shows the mechanical effect on URLs, decimals, contractions, code, and newlines", () => {
    const source = "Don't open https://cafe.example/a?x=1.25\nUse foo_bar() + C++.";
    expect(applyLocalWritingStyle(source, "no-punctuation")).toBe(
      "Dont open httpscafeexampleax=125\nUse foobar + C++",
    );
  });
});

describe("parseOneShotVoiceCommand", () => {
  it.each([
    ["Style lowercase.", "lowercase"],
    ["STYLE NO PUNCTUATION!", "no-punctuation"],
    ["style lowercase and no punctuation", "lowercase-no-punctuation"],
    ["style as transcribed", "as-transcribed"],
    ["style formal", "formal"],
  ] as const)("accepts the exact one-shot style phrase %s", (phrase, style) => {
    expect(parseOneShotVoiceCommand(phrase)).toEqual({ type: "style", style });
  });

  it("can cancel only the command recording, not the draft", () => {
    expect(parseOneShotVoiceCommand("cancel command.")).toEqual({ type: "cancel-command" });
  });

  it("returns a custom candidate with the user's exact spelling and punctuation", () => {
    const instructions = "Warm advertising copy, but keep NASA uppercase. 日本語も。";
    expect(parseOneShotVoiceCommand(`  STYLE ${instructions}  `)).toEqual({
      type: "custom-style",
      instructions,
    });
  });

  it("bounds custom instructions without silently truncating them", () => {
    const instructions = "a".repeat(DICTATION_REWRITE_INSTRUCTIONS_MAX_CHARS);
    expect(parseOneShotVoiceCommand(`style ${instructions}`)).toEqual({
      type: "custom-style",
      instructions,
    });
    expect(parseOneShotVoiceCommand(`style ${instructions}a`)).toBeNull();
    expect(parseOneShotVoiceCommand("style   ")).toBeNull();
    expect(parseOneShotVoiceCommand("style warm\u0000tone")).toBeNull();
  });

  it.each([
    "insert",
    "copy text",
    "paste",
    "submit",
    "style insert the draft",
    "style paste into the app",
    "style copy text",
    "style save this",
    "style reset",
    "style submit the form",
    "save",
    "reset",
    "cancel",
    "Style lowercase and insert",
    "I think the style lowercase is good",
    "The command is style formal",
    "style lowercase. then insert",
    "",
  ])("rejects unrelated or unsafe speech %s", (phrase) => {
    expect(parseOneShotVoiceCommand(phrase)).toBeNull();
  });
});
