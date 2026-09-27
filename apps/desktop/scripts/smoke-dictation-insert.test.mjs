import { describe, expect, it } from "vitest";
import { parseSmokeArguments, syntheticFixture } from "./smoke-dictation-insert.mjs";

describe("native dictation smoke admission", () => {
  it("requires an explicit native opt-in without opening a desktop or clipboard", () => {
    expect(() => parseSmokeArguments([])).toThrow("explicit_opt_in_required");
    expect(() => parseSmokeArguments(["--scenario", "success"])).toThrow(
      "explicit_opt_in_required",
    );
  });

  it("accepts only the bounded synthetic fixtures", () => {
    expect(
      parseSmokeArguments([
        "--run-native-test",
        "--external",
        "--editor",
        "textarea",
        "--scenario",
        "noop",
      ]),
    ).toMatchObject({ external: true, editor: "textarea", scenario: "noop" });
    expect(() => parseSmokeArguments(["--run-native-test", "--editor", "user-document"])).toThrow(
      "invalid_editor",
    );
    expect(() => parseSmokeArguments(["--run-native-test", "--scenario", "arbitrary"])).toThrow(
      "invalid_scenario",
    );
  });

  it("does not accept a supplied profile outside the private child channel", () => {
    expect(() =>
      parseSmokeArguments(["--run-native-test", "--fixture-user-data", "/unused"]),
    ).toThrow("private_child_option");
    expect(() =>
      parseSmokeArguments([
        "--run-native-test",
        "--synthetic-child",
        "--fixture-user-data",
        "/unused",
      ]),
    ).toThrow("private_parent_channel_required");
  });

  it("admits empty rich-editor qualification only for its fixed synthetic shape", () => {
    for (const scenario of [
      "empty",
      "empty-multiline",
      "empty-blocked",
      "empty-changed",
      "empty-ambiguous",
    ]) {
      expect(
        parseSmokeArguments([
          "--run-native-test",
          "--editor",
          "rich-contenteditable",
          "--scenario",
          scenario,
        ]),
      ).toMatchObject({ editor: "rich-contenteditable", scenario });
      expect(() =>
        parseSmokeArguments(["--run-native-test", "--editor", "textarea", "--scenario", scenario]),
      ).toThrow("invalid_fixture_pair");
    }
  });
});

describe("native dictation smoke postconditions", () => {
  it("uses exact logical paragraph text for empty editor insertion", () => {
    const fixture = syntheticFixture({
      editor: "rich-contenteditable",
      scenario: "empty-multiline",
    });
    expect(fixture.initialText).toBe("");
    expect(fixture.selection).toEqual([0, 0]);
    expect(fixture.expected).toBe(fixture.text);
    expect(fixture.expected).toContain("\n");
    expect(fixture.expectedOutcome).toBe("succeeded");
    expect(fixture.expectedInputEvents).toBe(1);
    expect(fixture.expectedPasteEvents).toBe(1);
  });

  it("does not remove a literal newline in either native-valued editor", () => {
    for (const editor of ["textarea", "rich-contenteditable"]) {
      const fixture = syntheticFixture({ editor, scenario: "literal-newline" });
      expect(fixture.expected).toBe(`${fixture.text}\n`);
      expect(fixture.initialText).toBe("\n");
      expect(fixture.expectedOutcome).toBe("succeeded");
    }
  });

  it("requires uncertainty when paste was dispatched but the editor rejected it", () => {
    expect(
      syntheticFixture({ editor: "rich-contenteditable", scenario: "empty-blocked" }),
    ).toMatchObject({
      expectedOutcome: "insertion_uncertain",
      expectedPasteEvents: 1,
      expectedInputEvents: 0,
    });
  });

  it("requires no key dispatch for changed identity or a pre-existing adjusted value", () => {
    expect(
      syntheticFixture({ editor: "rich-contenteditable", scenario: "empty-changed" }),
    ).toMatchObject({
      expectedOutcome: "target_changed",
      expectedPasteEvents: 0,
      expectedInputEvents: 0,
    });
    expect(
      syntheticFixture({ editor: "rich-contenteditable", scenario: "empty-ambiguous" }),
    ).toMatchObject({
      expectedOutcome: "target_unsupported",
      expectedPasteEvents: 0,
      expectedInputEvents: 0,
    });
  });

  it("does not turn collapsed blank-paragraph AX text into an exact acknowledgment", () => {
    expect(
      syntheticFixture({ editor: "rich-contenteditable", scenario: "multiline" }).expectedOutcome,
    ).toBe("insertion_uncertain");
    expect(syntheticFixture({ editor: "textarea", scenario: "multiline" }).expectedOutcome).toBe(
      "succeeded",
    );
  });
});
