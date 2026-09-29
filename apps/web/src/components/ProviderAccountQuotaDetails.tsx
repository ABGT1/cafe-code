import type { ReactNode } from "react";

import type { CodexRateLimitPresentation } from "../lib/codexRateLimits";
import { cn } from "../lib/utils";

export function UsageMeterBar(props: { readonly percent: number; readonly testId: string }) {
  const normalized = Math.max(0, Math.min(100, props.percent));
  return (
    <div
      aria-hidden="true"
      className="h-1.5 overflow-hidden rounded-full bg-muted/70"
      data-session-rail-usage-bar={props.testId}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}

/** One read-only rendering path for settings, composer details and the docked
 * rail. Provider strings remain React text, never markup, links or commands.
 * Additional buckets scroll within every surface; the reset count stays at
 * the bottom outside that scroll region so account-wide availability is clear. */
export function ProviderAccountQuotaDetails(props: {
  readonly presentation: CodexRateLimitPresentation;
  readonly layout?: "compact" | "popover" | "panel" | "settings";
  readonly action?: ReactNode;
}) {
  const { presentation } = props;
  const layout = props.layout ?? "compact";
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col gap-1.5 text-xs leading-snug text-muted-foreground/80 [overflow-wrap:anywhere]",
        layout === "popover" && "max-w-[min(28rem,calc(100vw-2rem))]",
        layout === "settings" && "@container/account-quota",
      )}
      data-account-quota
      data-account-quota-layout={layout}
    >
      {props.action ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <span>Usage</span>
          {props.action}
        </div>
      ) : null}
      {presentation.buckets.length ? (
        <div
          className="min-h-0 min-w-0 max-h-[40vh] space-y-2.5 overflow-y-auto"
          data-account-quota-scroll
        >
          {presentation.buckets.map((bucket) => (
            <section
              key={bucket.id}
              aria-label={`${bucket.label} quota`}
              data-account-quota-bucket={bucket.id}
              className="min-w-0 space-y-1.5"
            >
              {presentation.buckets.length > 1 ||
              bucket.id !== "codex" ||
              bucket.label !== "codex" ? (
                <div className="font-medium text-foreground">{bucket.label}</div>
              ) : null}
              {(["primary", "secondary"] as const).map((kind) => {
                const window = bucket[kind];
                const reset = kind === "primary" ? bucket.primaryReset : bucket.secondaryReset;
                if (!window && !reset) return null;
                return (
                  <div
                    key={kind}
                    className={cn(
                      "min-w-0",
                      // Settings has a full-width card, unlike the composer
                      // popover/rail. Use its own available width to keep a
                      // window's percentage and reset schedule on one row;
                      // only genuinely narrow cards stack the timestamp.
                      layout === "settings"
                        ? "grid items-baseline gap-x-6 gap-y-1 @min-[40rem]/account-quota:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                        : "space-y-1",
                    )}
                    data-account-quota-window={kind}
                    data-session-rail-rate-limit={layout === "panel" ? kind : undefined}
                  >
                    {window ? (
                      layout === "panel" ? (
                        <>
                          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">
                            {window.label}
                          </div>
                          <UsageMeterBar
                            percent={window.remainingPercent}
                            testId={`${kind}-window`}
                          />
                          <div className="text-[13px] font-medium text-foreground">
                            {window.value}
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                          <span>{window.label}</span>
                          <span className="text-right font-medium text-foreground">
                            {window.value}
                          </span>
                        </div>
                      )
                    ) : null}
                    {reset ? (
                      <p className={layout === "settings" && !window ? "col-span-full" : undefined}>
                        {reset}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {layout === "settings" && bucket.details.length > 0 ? (
                // Keep exact provider values, but do not make every credit or
                // spend-status field consume a full row on a wide desktop.
                <div className="flex min-w-0 flex-wrap gap-x-5 gap-y-1" data-account-quota-metadata>
                  {bucket.details.map((line) => (
                    <p key={line.label} className="min-w-0 max-w-full">
                      {line.text}
                    </p>
                  ))}
                </div>
              ) : (
                bucket.details.map((line) => <p key={line.label}>{line.text}</p>)
              )}
            </section>
          ))}
        </div>
      ) : null}
      {presentation.resetAvailability ? (
        <p className="shrink-0">{presentation.resetAvailability}</p>
      ) : null}
    </div>
  );
}
