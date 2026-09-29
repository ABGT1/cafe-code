import { EnvironmentId, ProjectId, ThreadId } from "@cafecode/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftId, DraftSessionState } from "../../composerDraftStore";
import type { SidebarThreadSummary } from "../../types";

const mocks = vi.hoisted(() => ({
  drafts: {} as Record<string, DraftSessionState>,
  threads: new Map<string, SidebarThreadSummary>(),
  projects: new Map<string, { name: string }>(),
  summaries: vi.fn(),
}));
vi.mock("../../composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => ({ draftThreadsByThreadKey: mocks.drafts }) },
}));
vi.mock("../../store", () => ({
  useStore: { getState: () => ({}) },
  selectSidebarThreadSummaryByRef: (
    _state: unknown,
    ref: { environmentId: string; threadId: string } | null,
  ) => {
    mocks.summaries(ref);
    return ref ? mocks.threads.get(`${ref.environmentId}/${ref.threadId}`) : undefined;
  },
  selectProjectByRef: (_state: unknown, ref: { environmentId: string; projectId: string }) =>
    mocks.projects.get(`${ref.environmentId}/${ref.projectId}`),
}));
vi.mock("../../uiStateStore", () => ({
  useUiStateStore: { getState: () => ({ threadLastVisitedAtById: {} }) },
}));
import { readDeskTabMetadata } from "./useDeskTabMetadata";

function fixture(environment: string): SidebarThreadSummary {
  return {
    id: ThreadId.make("same-id"),
    environmentId: EnvironmentId.make(environment),
    projectId: ProjectId.make("project"),
    title: `Chat ${environment}`,
    interactionMode: "default",
    session: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}
beforeEach(() => {
  mocks.drafts = {};
  mocks.threads.clear();
  mocks.projects.clear();
  mocks.summaries.mockClear();
});
describe("Desk tab shell metadata", () => {
  it("uses environment-scoped summaries without reading full transcripts", () => {
    for (const environment of ["local", "remote"]) {
      mocks.threads.set(`${environment}/same-id`, fixture(environment));
      mocks.projects.set(`${environment}/project`, { name: `${environment} project` });
    }
    const result = readDeskTabMetadata({
      kind: "server",
      threadRef: {
        environmentId: EnvironmentId.make("remote"),
        threadId: ThreadId.make("same-id"),
      },
    });
    expect(result.title).toBe("Chat remote");
    expect(result.projectName).toBe("remote project");
    expect(result.exists).toBe(true);
    expect(mocks.summaries).toHaveBeenCalledExactlyOnceWith({
      environmentId: "remote",
      threadId: "same-id",
    });
  });
  it.each([
    {
      source: "latest user message",
      latestUserMessageAt: "2026-09-29T01:00:00.000Z",
      updatedAt: "2026-09-29T02:00:00.000Z",
      expected: "2026-09-29T01:00:00.000Z",
    },
    {
      source: "updated shell",
      latestUserMessageAt: null,
      updatedAt: "2026-09-29T02:00:00.000Z",
      expected: "2026-09-29T02:00:00.000Z",
    },
    {
      source: "created shell",
      latestUserMessageAt: null,
      updatedAt: undefined,
      expected: "2026-09-29T00:00:00.000Z",
    },
  ])("uses the $source activity timestamp with Projects precedence", (testCase) => {
    const thread = fixture("local");
    mocks.threads.set("local/same-id", {
      ...thread,
      latestUserMessageAt: testCase.latestUserMessageAt,
      updatedAt: testCase.updatedAt,
    });
    const result = readDeskTabMetadata({
      kind: "server",
      threadRef: { environmentId: thread.environmentId, threadId: thread.id },
    });
    expect(result.activityAt).toBe(testCase.expected);
  });
  it("resolves a draft promotion through canonical thread metadata immediately", () => {
    const thread = fixture("local");
    const latestUserMessageAt = "2026-09-29T01:00:00.000Z";
    mocks.threads.set("local/same-id", {
      ...thread,
      latestUserMessageAt,
      hasPendingUserInput: true,
    });
    mocks.drafts.draft = {
      threadId: thread.id,
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      logicalProjectKey: "project",
      createdAt: thread.createdAt,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      envMode: "local",
      promotedTo: { environmentId: thread.environmentId, threadId: thread.id },
    };
    const result = readDeskTabMetadata({ kind: "draft", draftId: "draft" as DraftId });
    expect(result.title).toBe("Chat local");
    expect(result.attention).toBe(true);
    expect(result.threadRef).toEqual(mocks.drafts.draft.promotedTo);
    expect(result.activityAt).toBe(latestUserMessageAt);
  });
  it.each([false, true])(
    "uses the draft creation timestamp without a shell (promoted: %s)",
    (promoted) => {
      const thread = fixture("local");
      mocks.drafts.draft = {
        threadId: thread.id,
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        logicalProjectKey: "project",
        createdAt: "2026-09-28T23:00:00.000Z",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        envMode: "local",
        ...(promoted
          ? { promotedTo: { environmentId: thread.environmentId, threadId: thread.id } }
          : {}),
      };
      const result = readDeskTabMetadata({ kind: "draft", draftId: "draft" as DraftId });
      expect(result.activityAt).toBe("2026-09-28T23:00:00.000Z");
      expect(result.exists).toBe(true);
    },
  );
  it("has no activity timestamp for an unavailable draft", () => {
    const result = readDeskTabMetadata({ kind: "draft", draftId: "missing" as DraftId });
    expect(result.activityAt).toBeNull();
    expect(result.exists).toBe(false);
  });
  it("does not turn a temporarily absent shell summary into running or editable state", () => {
    const result = readDeskTabMetadata({
      kind: "server",
      threadRef: {
        environmentId: EnvironmentId.make("offline"),
        threadId: ThreadId.make("same-id"),
      },
    });
    expect(result).toMatchObject({
      title: "Unavailable chat",
      exists: false,
      working: false,
      attention: false,
      status: null,
      activityAt: null,
    });
  });
});
