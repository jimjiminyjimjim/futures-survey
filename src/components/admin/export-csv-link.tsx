"use client";

import { buttonVariants } from "@/components/ui/button";
import { ADMIN_MESSAGES } from "@/lib/admin/messages";

/**
 * ADM-03: a plain anchor (with `download`) to the export Route Handler, so
 * the browser's native download flow handles progress — no custom spinner
 * state. `buttonVariants` is only ever called in this "use client" file,
 * never a Server Component (project constraint). Renders for an empty
 * round too: a header-only export is a valid, documented case.
 */
export function ExportCsvLink({ roundId }: { roundId: string }) {
  return (
    <a
      href={`/admin/rounds/${roundId}/export`}
      download
      className={buttonVariants({ variant: "default" })}
    >
      {ADMIN_MESSAGES.exportCsv}
    </a>
  );
}
