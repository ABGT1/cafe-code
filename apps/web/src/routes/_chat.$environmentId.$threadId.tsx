import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { resolveThreadRouteRef } from "../threadRoutes";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const routeMatchesPrimaryEnvironment =
    threadRef !== null &&
    primaryEnvironmentId !== null &&
    threadRef.environmentId === primaryEnvironmentId;
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (threadRef !== null && primaryEnvironmentId !== null && !routeMatchesPrimaryEnvironment) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, primaryEnvironmentId, routeMatchesPrimaryEnvironment, threadRef]);

  // The shared chat layout owns pane mounts and draft promotion. Route guards
  // remain here, but navigation must not create a second view/queue dispatcher.
  return null;
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ChatThreadRouteView,
});
