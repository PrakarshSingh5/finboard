
"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { ChartSpec } from "@/types/agentContracts";

interface MetricChartProps {
  spec: ChartSpec;
}

const LINE_COLORS = ["#E3A438", "#5FAE8C", "#6E8CAE", "#C1584C"];

export function MetricChart({ spec }: MetricChartProps) {
  const periodsSet = new Set<string>();
  spec.series.forEach((s) => s.data.forEach((point) => periodsSet.add(point.x)));
  const periods = Array.from(periodsSet);

  const chartData = periods.map((period) => {
    const row: Record<string, string | number> = { period };
    for (const s of spec.series) {
      const match = s.data.find((point) => point.x === period);
      if (match) row[s.label] = match.y;
    }
    return row;
  });

  return (
    <div className="w-full">
      <h4 className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted mb-3">
        {spec.title}
      </h4>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#262B30" vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11, fill: "#8B9096", fontFamily: "var(--font-jetbrains-mono)" }}
            axisLine={{ stroke: "#262B30" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#8B9096", fontFamily: "var(--font-jetbrains-mono)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1C2024",
              border: "1px solid #262B30",
              borderRadius: 8,
              fontFamily: "var(--font-jetbrains-mono)",
              fontSize: 12,
            }}
            labelStyle={{ color: "#8B9096" }}
            formatter={(value) => {
              const num = typeof value === "number" ? value : Number(value);
              return Number.isFinite(num) ? `${(num * 100).toFixed(1)}%` : "—";
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--font-jetbrains-mono)" }} />
          {spec.series.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3, fill: LINE_COLORS[i % LINE_COLORS.length] }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}