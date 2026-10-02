import { describe, expect, it } from "vitest";

import { formatWorkspaceRelativePath } from "./filePathDisplay";

describe("formatWorkspaceRelativePath", () => {
  it.each(["/Users/example/repo", "/home/example/repo"])(
    "keeps POSIX display comparisons case-sensitive under %s",
    (cwd) => {
      expect(formatWorkspaceRelativePath(`${cwd}/src/review(final).md:2:7`, cwd)).toBe(
        "repo/src/review(final).md:2:7",
      );
      const differentCase = cwd.replace("repo", "Repo");
      expect(formatWorkspaceRelativePath(`${differentCase}/src/review.md`, cwd)).toBe(
        `${differentCase}/src/review.md`,
      );
    },
  );
  it("formats absolute workspace paths from the workspace root", () => {
    expect(
      formatWorkspaceRelativePath(
        "C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("prefixes relative paths with the workspace root label", () => {
    expect(
      formatWorkspaceRelativePath(
        "apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("keeps paths already rooted at the workspace label stable", () => {
    expect(
      formatWorkspaceRelativePath(
        "t3code/apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("preserves columns when present", () => {
    expect(
      formatWorkspaceRelativePath(
        "/C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts:501:9",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501:9");
  });

  it("does not prefix outside absolute windows paths as workspace-relative", () => {
    expect(
      formatWorkspaceRelativePath(
        "C:/Users/mike/other/project/readme.md",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("C:/Users/mike/other/project/readme.md");
  });
});
