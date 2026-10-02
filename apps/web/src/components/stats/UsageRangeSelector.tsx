import { cn } from "../../lib/utils";
import { USAGE_RANGES, type UsageRangeKey } from "./usageRange";

/** A single, accessible calendar-range control shared by both usage surfaces. */
export function UsageRangeSelector({
  value,
  onChange,
}: {
  value: UsageRangeKey;
  onChange: (value: UsageRangeKey) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Usage date range"
      className="flex shrink-0 overflow-hidden rounded-md border border-border/70 text-[11px]"
    >
      {USAGE_RANGES.map((entry) => (
        <button
          key={entry.key}
          type="button"
          aria-pressed={value === entry.key}
          onClick={() => onChange(entry.key)}
          className={cn(
            "px-2.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
            value === entry.key
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
