import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ComposedChart,
} from "recharts";
import type { Entry, WearSession } from "../lib/models";
import { summary, dailyWear, dayKey, shiftDay, duration } from "../lib/time";
export function Stats({
  entries,
  sessions,
  now,
  onDay,
}: {
  entries: Entry[];
  sessions: WearSession[];
  now: number;
  onDay: (day: string) => void;
}) {
  const [range, setRange] = useState(7);
  const stats = useMemo(
    () => summary(entries, sessions, now),
    [entries, sessions, now],
  );
  const wear = useMemo(() => dailyWear(sessions, now), [sessions, now]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) {
      const d = dayKey(e.timestamp);
      m[d] = (m[d] ?? 0) + 1;
    }
    return m;
  }, [entries]);
  const data = Array.from({ length: range }, (_, i) => {
    const day = shiftDay(dayKey(now), i - range + 1);
    return {
      day,
      label: day.slice(5).replace("-", "/"),
      checkins: counts[day] ?? 0,
      hours: Math.round(((wear[day] ?? 0) / 3600000) * 100) / 100,
    };
  });
  const heat = Array.from({ length: 84 }, (_, i) =>
    shiftDay(dayKey(now), i - 83),
  );
  return (
    <>
      <div className="stat-grid">
        <div className="card metric">
          <span>今日 / 本周 / 本月</span>
          <strong>
            {stats.today}
            <small>
              {" "}
              / {stats.week} / {stats.month}
            </small>
          </strong>
          <p>打卡次数 · 本周从周一开始</p>
        </div>
        <div className="card metric">
          <span>累计照片</span>
          <strong>
            {stats.photos}
            <small> 张</small>
          </strong>
          <p>共 {entries.length} 次打卡</p>
        </div>
        <div className="card metric">
          <span>累计佩戴</span>
          <strong>
            {(stats.total / 3600000).toFixed(1)}
            <small> 小时</small>
          </strong>
          <p>重叠时间已合并</p>
        </div>
        <div className="card metric">
          <span>连续打卡</span>
          <strong>
            {stats.current}
            <small> 天</small>
          </strong>
          <p>历史最长 {stats.longest} 天</p>
        </div>
      </div>
      <div className="card stat-detail">
        <span>最长单次佩戴</span>
        <strong>{duration(stats.longestWear)}</strong>
      </div>
      <div className="card chart-card">
        <div className="section-line">
          <h2>记录趋势</h2>
          <div className="range-select">
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                className={n === range ? "selected" : ""}
                onClick={() => setRange(n)}
              >
                {n} 天
              </button>
            ))}
          </div>
        </div>
        <div className="chart-legend">
          <span>
            <i />
            打卡次数
          </span>
          <span>
            <i className="teal" />
            佩戴小时
          </span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ left: -26, right: -20, top: 8, bottom: 0 }}
            >
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                minTickGap={25}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="count"
                allowDecimals={false}
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="hours"
                orientation="right"
                domain={[0, 24]}
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                }}
              />
              <Bar
                isAnimationActive={false}
                yAxisId="count"
                name="打卡次数"
                dataKey="checkins"
                fill="var(--accent)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
              <Line
                isAnimationActive={false}
                yAxisId="hours"
                name="佩戴小时"
                dataKey="hours"
                stroke="var(--teal)"
                dot={false}
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {!entries.length && !sessions.length && (
          <p className="muted">还没有数据，图表会随真实记录更新。</p>
        )}
      </div>
      <div className="card heat-card">
        <div className="section-line">
          <h2>打卡足迹</h2>
          <span className="muted">最近 12 周</span>
        </div>
        <div className="heat-grid">
          {heat.map((day) => (
            <button
              key={day}
              className={`heat heat-${Math.min(counts[day] ?? 0, 4)}`}
              aria-label={`${day}，${counts[day] ?? 0} 次打卡`}
              title={`${day}：${counts[day] ?? 0} 次`}
              onClick={() => onDay(day)}
            />
          ))}
        </div>
        <div className="heat-key">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} className={`heat-${n}`} />
          ))}
          <span>多</span>
        </div>
      </div>
      <div className="card">
        <div className="section-line">
          <h2>每日佩戴时长</h2>
        </div>
        {data
          .slice()
          .reverse()
          .map((d) => (
            <div className="data-row" key={d.day}>
              <span>{d.day}</span>
              <strong>{duration(wear[d.day] ?? 0)}</strong>
            </div>
          ))}
      </div>
    </>
  );
}
