import { describe, expect, it } from "vitest";

import {
  decodeMarkdownLinkDestination,
  extractMarkdownLinkDestinations,
  isPathInsideWorkspace,
  resolveMarkdownFileLinkMeta,
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
} from "./markdown-links";

describe("Markdown destination source ranges", () => {
  it("ignores destinations inside closed and streaming code fences", () => {
    const source = [
      "[Before](src/before.md)",
      "```math",
      "[f](x^2)",
      "```",
      "[After](src/after.md)",
      "~~~text",
      "[Literal](src/literal.md)",
    ].join("\n");
    expect(extractMarkdownLinkDestinations(source).map(({ value }) => value)).toEqual([
      "src/before.md",
      "src/after.md",
    ]);
  });
  it("bounds malformed destinations and nesting instead of scanning an entire message per opening", () => {
    const oversized = "[Review](<C:/repo/" + "x".repeat(32_768) + ".md>)";
    const tooDeep = "[Review](src/" + "(".repeat(33) + "review" + ")".repeat(33) + ".md)";
    expect(extractMarkdownLinkDestinations(oversized)).toEqual([]);
    expect(extractMarkdownLinkDestinations(tooDeep)).toEqual([]);
    expect(extractMarkdownLinkDestinations("][".repeat(1_000) + "]( ".repeat(1_000))).toEqual([]);
  });
  it("keeps balanced parentheses, angle destinations and reference definitions intact", () => {
    const source = String.raw`[nested](src/review(final(v2)).md:2:7)
[spaced](<C:\repo\review packets\(final).md>)

[notes]: </home/example/repo/review\(final\).md> "review title"`;
    expect(
      extractMarkdownLinkDestinations(source).map(({ value, start, end }) => {
        expect(source.slice(start, end)).toBe(value);
        return value;
      }),
    ).toEqual([
      "src/review(final(v2)).md:2:7",
      String.raw`C:\repo\review packets\(final).md`,
      String.raw`/home/example/repo/review\(final\).md`,
    ]);
  });

  it("decodes POSIX punctuation escapes while retaining native drive/UNC separators", () => {
    expect(decodeMarkdownLinkDestination(String.raw`src/review\(final\).md`)).toBe(
      "src/review(final).md",
    );
    expect(decodeMarkdownLinkDestination(String.raw`C:\repo\.docs\review.md`)).toBe(
      String.raw`C:\repo\.docs\review.md`,
    );
    expect(decodeMarkdownLinkDestination(String.raw`\\server\share\.docs\review.md`)).toBe(
      String.raw`\\server\share\.docs\review.md`,
    );
    expect(decodeMarkdownLinkDestination(String.raw`C:\repo\.docs\review &amp; notes.md`)).toBe(
      String.raw`C:\repo\.docs\review & notes.md`,
    );
    expect(decodeMarkdownLinkDestination(String.raw`.\.docs\review.md`, "C:/repo")).toBe(
      String.raw`.\.docs\review.md`,
    );
  });

  it.each([
    "C:/repo",
    String.raw`C:\repo`,
    String.raw`\\server\share\repo`,
    "/Users/example/repo",
    "/home/example/repo",
  ])("retains CommonMark punctuation escapes in slash-based relative URLs under %s", (cwd) => {
    expect(decodeMarkdownLinkDestination(String.raw`src/review\(final\).md`, cwd)).toBe(
      "src/review(final).md",
    );
    expect(decodeMarkdownLinkDestination(String.raw`review\(final\).md`, cwd)).toBe(
      "review(final).md",
    );
    expect(decodeMarkdownLinkDestination(String.raw`review\_final.md`, cwd)).toBe(
      "review_final.md",
    );
  });

  it("retains genuinely native backslash relative directories under a Windows cwd", () => {
    expect(decodeMarkdownLinkDestination(String.raw`src\.docs\review.md`, "C:/repo")).toBe(
      String.raw`src\.docs\review.md`,
    );
    expect(decodeMarkdownLinkDestination(String.raw`.\_docs\review.md`, "C:/repo")).toBe(
      String.raw`.\_docs\review.md`,
    );
  });
});

describe("rewriteMarkdownFileUriHref", () => {
  it("preserves remote file authorities as UNC shares instead of opening a local path", () => {
    expect(rewriteMarkdownFileUriHref("file://server/share/review%20(final).md#L2C7")).toBe(
      String.raw`\\server\share\review%20(final).md#L2C7`,
    );
    expect(resolveMarkdownFileLinkTarget("file://server/share/review%20(final).md#L2C7")).toBe(
      String.raw`\\server\share\review (final).md:2:7`,
    );
  });
  it("rewrites file uri hrefs into direct path hrefs", () => {
    expect(rewriteMarkdownFileUriHref("file:///Users/julius/project/src/main.ts#L42")).toBe(
      "/Users/julius/project/src/main.ts#L42",
    );
  });

  it("preserves encoded octets so file paths are decoded only once later", () => {
    expect(rewriteMarkdownFileUriHref("file:///Users/julius/project/file%2520name.md")).toBe(
      "/Users/julius/project/file%2520name.md",
    );
  });

  it("normalizes file uri hrefs for windows drive paths", () => {
    expect(
      rewriteMarkdownFileUriHref(
        "file:///D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx#L69",
      ),
    ).toBe("D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx#L69");
  });

  it("unwraps angle-bracketed file uri hrefs", () => {
    expect(
      rewriteMarkdownFileUriHref(" <file:///D:/Programme/t3code/apps/web/src/markdown-links.ts> "),
    ).toBe("D:/Programme/t3code/apps/web/src/markdown-links.ts");
  });
});

describe("resolveMarkdownFileLinkTarget", () => {
  it("resolves absolute posix file paths", () => {
    expect(resolveMarkdownFileLinkTarget("/Users/julius/project/AGENTS.md")).toBe(
      "/Users/julius/project/AGENTS.md",
    );
  });

  it("resolves relative file paths against cwd", () => {
    expect(resolveMarkdownFileLinkTarget("src/processRunner.ts:71", "/Users/julius/project")).toBe(
      "/Users/julius/project/src/processRunner.ts:71",
    );
  });

  it("resolves relative file paths containing spaces and parentheses", () => {
    const href = ".cafe-code-link-smoke/folder with spaces/review (final).md";
    const cwd = "C:/repo/project";

    expect(resolveMarkdownFileLinkTarget(href, cwd)).toBe(
      "C:/repo/project/.cafe-code-link-smoke/folder with spaces/review (final).md",
    );
  });

  it("does not treat filename line references as external schemes", () => {
    expect(resolveMarkdownFileLinkTarget("script.ts:10", "/Users/julius/project")).toBe(
      "/Users/julius/project/script.ts:10",
    );
  });

  it("resolves bare file names against cwd", () => {
    expect(resolveMarkdownFileLinkTarget("AGENTS.md", "/Users/julius/project")).toBe(
      "/Users/julius/project/AGENTS.md",
    );
  });

  it("maps #L line anchors to editor line suffixes", () => {
    expect(resolveMarkdownFileLinkTarget("/Users/julius/project/src/main.ts#L42C7")).toBe(
      "/Users/julius/project/src/main.ts:42:7",
    );
  });

  it("ignores external urls", () => {
    expect(resolveMarkdownFileLinkTarget("https://example.com/docs")).toBeNull();
  });

  it.each([
    "//example.com/review.md",
    "javascript:alert(1)",
    "javascript%3Aalert(1)",
    "data:text/html,alert(1)",
    "vbscript:alert(1)",
    "https://example.com/review.md",
    "#review.md",
  ])("never classifies a web/hostile destination as a native file: %s", (href) => {
    expect(resolveMarkdownFileLinkTarget(href, "C:/repo")).toBeNull();
  });

  it("does not double-decode file URLs", () => {
    expect(resolveMarkdownFileLinkTarget("file:///Users/julius/project/file%2520name.md")).toBe(
      "/Users/julius/project/file%20name.md",
    );
  });

  it("formats tooltip display paths relative to the cwd when possible", () => {
    expect(
      resolveMarkdownFileLinkMeta(
        "file:///C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts#L501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toMatchObject({
      displayPath: "t3code/apps/web/src/session-logic.ts:501",
    });
  });

  it("formats tooltip display paths relative to the cwd for slash-prefixed windows paths", () => {
    expect(
      resolveMarkdownFileLinkMeta(
        "/C:/Users/mike/dev-stuff/t3code/apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toMatchObject({
      displayPath:
        "t3code/apps/web/src/components/chat/MessagesTimeline.virtualization.browser.tsx",
    });
  });

  it("normalizes slash-prefixed windows drive paths before resolving", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        "/D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx#L69",
      ),
    ).toBe("D:/Programme/t3code/apps/web/src/components/chat/OpenInPicker.tsx:69");
  });

  it("normalizes mixed separators at a windows drive root before resolving", () => {
    const malformedPath = "C:/\\repo\\Example Project.docs\\runbooks\\review-notes.md";

    expect(resolveMarkdownFileLinkTarget(malformedPath, "C:/repo/Example Project.docs")).toBe(
      "C:/repo/Example Project.docs/runbooks/review-notes.md",
    );
    expect(
      resolveMarkdownFileLinkMeta(malformedPath, "C:/repo/Example Project.docs"),
    ).toMatchObject({
      displayPath: "Example Project.docs/runbooks/review-notes.md",
      openPolicy: "direct",
    });
  });

  it("normalizes separators after resolving a relative path against a windows drive cwd", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        ".cafe-code-link-smoke/folder with spaces/review (final).md",
        "C:/repo/project",
      ),
    ).toBe("C:/repo/project/.cafe-code-link-smoke/folder with spaces/review (final).md");
  });

  it("resolves angle-bracketed windows drive paths", () => {
    expect(
      resolveMarkdownFileLinkTarget(
        "</D:/Programme/t3code/apps/web/src/components/ChatMarkdown.tsx:1>",
      ),
    ).toBe("D:/Programme/t3code/apps/web/src/components/ChatMarkdown.tsx:1");
  });

  it("does not treat app routes as file links", () => {
    expect(resolveMarkdownFileLinkTarget("/chat/settings")).toBeNull();
  });
});

describe("markdown file link workspace policy", () => {
  it.each([
    ["/Users/example/repo", "/Users/example/repo/../outside.md"],
    ["/home/example/repo", "/home/example/repo/src/../../outside.md"],
    ["/home/example/repo", "../outside.md"],
    ["C:/repo/project", "C:/repo/project/../outside.md"],
    ["C:/repo/project", "..\\outside.md"],
    [String.raw`\\server\share\repo`, String.raw`\\server\share\repo\..\outside.md`],
  ])("requires consent for traversal from %s to %s", (cwd, href) => {
    expect(resolveMarkdownFileLinkMeta(href, cwd)?.openPolicy).toBe("confirm");
  });

  it("retains case-sensitive POSIX workspace comparisons and treats prefixes as whole segments", () => {
    expect(isPathInsideWorkspace("/home/example/Repo/review.md", "/home/example/repo")).toBe(false);
    expect(isPathInsideWorkspace("/home/example/repository/review.md", "/home/example/repo")).toBe(
      false,
    );
    expect(isPathInsideWorkspace("C:/REPO/review.md", "c:/repo")).toBe(true);
  });
  it("allows direct opens for POSIX paths inside the workspace", () => {
    expect(
      resolveMarkdownFileLinkMeta("/Users/julius/project/src/main.ts#L42", "/Users/julius/project"),
    ).toMatchObject({
      targetPath: "/Users/julius/project/src/main.ts:42",
      openPolicy: "direct",
    });
  });

  it("requires confirmation for POSIX paths outside the workspace", () => {
    expect(resolveMarkdownFileLinkMeta("/etc/passwd", "/Users/julius/project")).toMatchObject({
      targetPath: "/etc/passwd",
      openPolicy: "confirm",
    });
    expect(resolveMarkdownFileLinkMeta("/tmp/output.log", "/Users/julius/project")).toMatchObject({
      targetPath: "/tmp/output.log",
      openPolicy: "confirm",
    });
  });

  it("handles macOS volume paths by workspace containment", () => {
    expect(
      resolveMarkdownFileLinkMeta("/Volumes/Data/project/src/main.ts", "/Volumes/Data/project"),
    ).toMatchObject({
      openPolicy: "direct",
    });
    expect(
      resolveMarkdownFileLinkMeta("/Volumes/Secrets/key.txt", "/Volumes/Data/project"),
    ).toMatchObject({
      openPolicy: "confirm",
    });
  });

  it("handles Windows drive and UNC workspace containment", () => {
    expect(
      resolveMarkdownFileLinkMeta("C:/Users/mike/project/src/main.ts", "C:/Users/mike/project"),
    ).toMatchObject({
      openPolicy: "direct",
    });
    expect(
      resolveMarkdownFileLinkMeta("C:/Users/mike/other/secret.txt", "C:/Users/mike/project"),
    ).toMatchObject({
      openPolicy: "confirm",
    });
    expect(
      resolveMarkdownFileLinkMeta(
        "\\\\server\\share\\project\\src\\main.ts",
        "\\\\server\\share\\project",
      ),
    ).toMatchObject({
      openPolicy: "direct",
    });
    expect(
      resolveMarkdownFileLinkMeta(
        "\\\\server\\share\\other\\secret.txt",
        "\\\\server\\share\\project",
      ),
    ).toMatchObject({
      openPolicy: "confirm",
    });
  });

  it("treats relative and file URL links according to the resolved workspace path", () => {
    expect(resolveMarkdownFileLinkMeta("src/main.ts", "/Users/julius/project")).toMatchObject({
      targetPath: "/Users/julius/project/src/main.ts",
      openPolicy: "direct",
    });
    expect(
      resolveMarkdownFileLinkMeta(
        "file:///Users/julius/project/src/main.ts",
        "/Users/julius/project",
      ),
    ).toMatchObject({
      targetPath: "/Users/julius/project/src/main.ts",
      openPolicy: "direct",
    });
    expect(
      resolveMarkdownFileLinkMeta("file:///private/etc/hosts", "/Users/julius/project"),
    ).toMatchObject({
      targetPath: "/private/etc/hosts",
      openPolicy: "confirm",
    });
  });

  it("uses exact path boundaries for workspace checks", () => {
    expect(isPathInsideWorkspace("/Users/julius/projected/file.ts", "/Users/julius/project")).toBe(
      false,
    );
    expect(
      isPathInsideWorkspace("/Users/julius/project/file.ts:4:2", "/Users/julius/project"),
    ).toBe(true);
  });

  it("treats configured additional directories as direct-open workspace paths", () => {
    expect(
      isPathInsideWorkspace("/Users/julius/docs/README.md", "/Users/julius/project", [
        "/Users/julius/docs",
      ]),
    ).toBe(true);
    expect(
      resolveMarkdownFileLinkMeta("file:///Users/julius/docs/README.md", "/Users/julius/project", [
        "/Users/julius/docs",
      ]),
    ).toMatchObject({
      openPolicy: "direct",
    });
  });
});
