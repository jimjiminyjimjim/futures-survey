"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { formatMean } from "@/lib/presentation/chart-math";
import type { OverviewTerm } from "@/lib/presentation/types";

const config: ChartConfig = {
  mean: { label: "Mean familiarity", color: "var(--pres-familiarity-3)" },
};

export function RankingChart({ terms }: { terms: OverviewTerm[] }) {
  const data = terms.map((t) => ({ name: t.statementKey, mean: t.mean }));

  return (
    <div className="flex max-h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <ChartContainer
        config={config}
        aria-hidden="true"
        className="aspect-auto h-[min(60vh,28rem)] w-full"
      >
        <BarChart data={data} layout="vertical">
          <XAxis type="number" domain={[0, 4]} hide />
          <YAxis type="category" dataKey="name" hide />
          <Bar dataKey="mean" fill="var(--pres-familiarity-3)" />
        </BarChart>
      </ChartContainer>

      <ol
        aria-label={PRESENTATION_MESSAGES.rankingLabel}
        className="flex flex-col gap-2"
      >
        {terms.map((term) => (
          <li
            key={term.statementKey}
            className="flex items-baseline justify-between gap-4"
          >
            <span className="text-[28px] leading-[1.5] break-words">
              {term.text}
            </span>
            <span className="tabular-nums text-[20px] text-pres-ink-secondary">
              {formatMean(term.mean)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
