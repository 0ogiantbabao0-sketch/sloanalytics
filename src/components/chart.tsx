"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
export default function TrendChart({
  rows,
}: {
  rows: { date: string; avg: number }[];
}) {
  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={rows}>
          <defs>
            <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b78ed" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#3b78ed" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e9edf4" />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => v.slice(5)}
            minTickGap={35}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            width={50}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => [
              `${Math.round(Number(v)).toLocaleString()}枚`,
              "平均差枚",
            ]}
          />
          <ReferenceLine y={0} stroke="#aebdce" />
          <Area
            type="monotone"
            dataKey="avg"
            stroke="#3878ed"
            strokeWidth={2}
            fill="url(#blue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
