"use client";

import {
  Bar,
  BarChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import { PRESENTATION_MESSAGES } from "@/lib/presentation/messages";
import { optionPercent, optionShare } from "@/lib/presentation/chart-math";
import type { OptionCount } from "@/lib/presentation/types";

type Variant = "diverging" | "ordered";

function colorFor(variant: Variant, value: number): string {
  return variant === "diverging"
    ? `var(--pres-agreement-${value})`
    : `var(--pres-familiarity-${value})`;
}

export function DistributionChart({
  variant,
  options,
  respondentCount,
}: {
  variant: Variant;
  options: OptionCount[];
  respondentCount: number;
}) {
  const byValue = new Map(options.map((o) => [o.value, o]));

  const config: ChartConfig = {};
  for (const o of options) {
    config[`opt${o.value}`] = {
      label: o.label,
      color: colorFor(variant, o.value),
    };
  }

  let chart: React.ReactNode;

  if (variant === "diverging") {
    const opt1 = byValue.get(1);
    const opt2 = byValue.get(2);
    const opt3 = byValue.get(3);
    const opt4 = byValue.get(4);
    const opt5 = byValue.get(5);

    const share1 = opt1 ? optionShare(opt1.count, respondentCount) : 0;
    const share2 = opt2 ? optionShare(opt2.count, respondentCount) : 0;
    const share3 = opt3 ? optionShare(opt3.count, respondentCount) : 0;
    const share4 = opt4 ? optionShare(opt4.count, respondentCount) : 0;
    const share5 = opt5 ? optionShare(opt5.count, respondentCount) : 0;

    const data = [
      {
        name: "statement",
        neutralLeft: -share3 / 2,
        opt2: -share2,
        opt1: -share1,
        neutralRight: share3 / 2,
        opt4: share4,
        opt5: share5,
      },
    ];

    chart = (
      <BarChart data={data} layout="vertical" stackOffset="sign">
        <XAxis type="number" domain={[-100, 100]} hide />
        <YAxis type="category" dataKey="name" hide />
        <ReferenceLine x={0} stroke="var(--pres-border)" />
        <Bar
          dataKey="neutralLeft"
          stackId="a"
          fill="var(--pres-agreement-3)"
        />
        <Bar dataKey="opt2" stackId="a" fill="var(--pres-agreement-2)" />
        <Bar dataKey="opt1" stackId="a" fill="var(--pres-agreement-1)" />
        <Bar
          dataKey="neutralRight"
          stackId="a"
          fill="var(--pres-agreement-3)"
        />
        <Bar dataKey="opt4" stackId="a" fill="var(--pres-agreement-4)" />
        <Bar dataKey="opt5" stackId="a" fill="var(--pres-agreement-5)" />
      </BarChart>
    );
  } else {
    const data: Record<string, number | string> = { name: "statement" };
    const sortedOptions = [...options].sort((a, b) => a.value - b.value);
    for (const o of sortedOptions) {
      data[`opt${o.value}`] = optionShare(o.count, respondentCount);
    }

    chart = (
      <BarChart data={[data]} layout="vertical" stackOffset="sign">
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis type="category" dataKey="name" hide />
        {sortedOptions.map((o) => (
          <Bar
            key={o.value}
            dataKey={`opt${o.value}`}
            stackId="a"
            fill={colorFor(variant, o.value)}
          />
        ))}
      </BarChart>
    );
  }

  const sortedOptions = [...options].sort((a, b) => a.value - b.value);

  return (
    <div className="rounded-lg bg-pres-surface p-8">
      <ChartContainer
        config={config}
        aria-hidden="true"
        className="aspect-auto h-40 w-full"
      >
        {chart}
      </ChartContainer>

      <ul
        aria-label={PRESENTATION_MESSAGES.breakdownLabel}
        className="mt-6 flex flex-col gap-3"
      >
        {sortedOptions.map((o) => (
          <li key={o.value} className="flex items-center gap-3">
            <span
              className="size-4 shrink-0 rounded-sm"
              style={{ backgroundColor: colorFor(variant, o.value) }}
            />
            <span className="flex-1 text-[20px] break-words">{o.label}</span>
            <span className="tabular-nums text-[20px]">
              {o.count} · {optionPercent(o.count, respondentCount)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
