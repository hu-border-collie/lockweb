import { memo, useMemo, useState } from "react";
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
import type { Entry, WearSession, JournalSettings } from "../lib/models";
import { insights } from "../lib/journal";
import { ShareCard } from "./ShareCard";
import { FateHistory } from "./FateWheel";
import type { FateState } from "../lib/fate";
import { summary, dailyWear, dayKey, shiftDay, duration } from "../lib/time";
export const Stats = memo(function Stats({
  entries,
  sessions,
  now,
  onDay,
  settings,
  fate,
}: {
  entries: Entry[];
  sessions: WearSession[];
  now: number;
  onDay: (day: string) => void;
  settings: JournalSettings;
  fate: FateState;
}) {
  const [range, setRange] = useState(7);
  const stats = useMemo(
    () => summary(entries, sessions, now, settings.breakThresholdMinutes),
    [entries, sessions, now, settings.breakThresholdMinutes],
  );
  const analysis = useMemo(
    () => insights(entries, sessions, settings, now),
    [entries, sessions, settings, now],
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
  const data = useMemo(
    () =>
      Array.from({ length: range }, (_, i) => {
        const day = shiftDay(dayKey(now), i - range + 1);
        return {
          day,
          label: day.slice(5).replace("-", "/"),
          checkins: counts[day] ?? 0,
          hours: Math.round(((wear[day] ?? 0) / 3600000) * 100) / 100,
        };
      }),
    [range, now, counts, wear],
  );
  const heat = useMemo(
    () => Array.from({ length: 84 }, (_, i) => shiftDay(dayKey(now), i - 83)),
    [now],
  );
  return (
    <div className="stat-page">
      <ShareCard entries={entries} sessions={sessions} now={now} />
      <FateHistory state={fate} />
      <div className="stat-grid">
        <div className="card metric">
          <span>今天 · 本周 · 本月</span>
          <strong>
            {stats.today}
            <small> 条</small>
          </strong>
          <p>
            本周 {stats.week} 条 · 本月 {stats.month} 条
          </p>
        </div>
        <div className="card metric">
          <span>照片总数</span>
          <strong>
            {stats.photos}
            <small> 张</small>
          </strong>
          <p>共 {entries.length} 条记录</p>
        </div>
        <div className="card metric">
          <span>佩戴总时长</span>
          <strong>
            {(stats.total / 3600000).toFixed(1)}
            <small> 小时</small>
          </strong>
          <p>重叠的时间只算一次</p>
        </div>
        <div className="card metric">
          <span>连续记录</span>
          <strong>
            {stats.current}
            <small> 天</small>
          </strong>
          <p>最长连续 {stats.longest} 天</p>
        </div>
      </div>
      <div className="card stat-card stat-detail">
        <span>最长的一次佩戴</span>
        <strong>{duration(stats.longestWear)}</strong>
      </div>
      <div className="card stat-card">
        <h2>舒适度与佩戴时长</h2>
        <p className="muted">
          按记录时已佩戴的小时数分组，仅含关联了时段、佩戴中且有评分的记录。只反映相关性。
        </p>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={analysis.comfort}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[1, 5]}
                width={28}
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--paper-raised)",
                  border: "1px solid var(--rule)",
                  borderRadius: 4,
                  fontSize: 12,
                  padding: "8px 10px",
                  boxShadow: "var(--shadow)",
                }}
                labelStyle={{ color: "var(--ink-soft)" }}
                itemStyle={{ color: "var(--ink)" }}
                cursor={{ stroke: "var(--rule-strong)" }}
              />
              <Line
                dataKey="average"
                name="平均舒适度"
                stroke="var(--seal)"
                strokeWidth={2}
                dot={{ r: 2, fill: "var(--seal)", stroke: "var(--seal)" }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {analysis.comfort.map((b) => (
          <div className="data-row" key={b.name}>
            <span>
              {b.name} · {b.count} 个评分
            </span>
            <strong>
              {b.average === null ? "无评分" : b.average.toFixed(2)}
            </strong>
          </div>
        ))}
      </div>
      <div className="card stat-card">
        <h2>标签与舒适度</h2>
        {analysis.tags.length ? (
          <>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analysis.tags.slice(0, 20)}>
                  <CartesianGrid stroke="var(--rule)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 5]}
                    width={28}
                    tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--paper-raised)",
                      border: "1px solid var(--rule)",
                      borderRadius: 4,
                      fontSize: 12,
                      padding: "8px 10px",
                      boxShadow: "var(--shadow)",
                    }}
                    labelStyle={{ color: "var(--ink-soft)" }}
                    itemStyle={{ color: "var(--ink)" }}
                    cursor={{ fill: "var(--paper-sunken)" }}
                  />
                  <Bar
                    dataKey="average"
                    name="平均舒适度"
                    fill="var(--seal)"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {analysis.tags.map((t) => (
              <div className="data-row" key={t.name}>
                <span>
                  {t.name} · {t.count} 个评分
                </span>
                <strong>
                  {t.average === null ? "无评分" : t.average.toFixed(2)}
                </strong>
              </div>
            ))}
          </>
        ) : (
          <p className="muted">暂无带标签的记录</p>
        )}
      </div>
      <div className="card stat-card">
        <h2>记录时段分布</h2>
        <div className="chart-legend">
          <span>
            <i aria-hidden="true" />
            佩戴中
          </span>
          <span>
            <i className="moss" aria-hidden="true" />
            未佩戴
          </span>
          <span>
            <i className="faint" aria-hidden="true" />
            未记录状态
          </span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analysis.hours}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                minTickGap={25}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={28}
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--paper-raised)",
                  border: "1px solid var(--rule)",
                  borderRadius: 4,
                  fontSize: 12,
                  padding: "8px 10px",
                  boxShadow: "var(--shadow)",
                }}
                labelStyle={{ color: "var(--ink-soft)" }}
                itemStyle={{ color: "var(--ink)" }}
                cursor={{ fill: "var(--paper-sunken)" }}
              />
              <Bar
                dataKey="on"
                stackId="state"
                name="佩戴中"
                fill="var(--seal)"
                isAnimationActive={false}
              />
              <Bar
                dataKey="off"
                stackId="state"
                name="未佩戴"
                fill="var(--moss)"
                isAnimationActive={false}
              />
              <Bar
                dataKey="unspecified"
                stackId="state"
                name="未记录状态"
                fill="var(--ink-faint)"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card stat-card">
        <h2>装备使用对比</h2>
        <p className="muted">
          同一装备的重叠时段合并计算，已扣除暂停。不同装备的时长不相加。
        </p>
        {analysis.gears.length ? (
          analysis.gears.map((g, i) => (
            <div className="data-row" key={i}>
              <span>{g.name}</span>
              <strong>
                {g.hours.toFixed(1)} 小时 ·{" "}
                {g.average === null
                  ? "无评分"
                  : `${g.average.toFixed(2)} 分（${g.count} 次）`}
              </strong>
            </div>
          ))
        ) : (
          <p className="muted">添加装备并在记录中关联后显示。</p>
        )}
      </div>
      <div className="card stat-card chart-card">
        <div className="section-line">
          <h2>记录趋势</h2>
          <div className="range-select" role="group" aria-label="趋势区间">
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                type="button"
                className={n === range ? "selected" : ""}
                aria-pressed={n === range}
                onClick={() => setRange(n)}
              >
                {n} 天
              </button>
            ))}
          </div>
        </div>
        <div className="chart-legend">
          <span>
            <i aria-hidden="true" />
            记录条数
          </span>
          <span>
            <i className="moss" aria-hidden="true" />
            佩戴小时
          </span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ left: -26, right: -20, top: 8, bottom: 0 }}
            >
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                minTickGap={25}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="count"
                allowDecimals={false}
                width={32}
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="hours"
                orientation="right"
                domain={[0, 24]}
                width={32}
                tick={{ fill: "var(--ink-faint)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--paper-raised)",
                  border: "1px solid var(--rule)",
                  borderRadius: 4,
                  fontSize: 12,
                  padding: "8px 10px",
                  boxShadow: "var(--shadow)",
                }}
                labelStyle={{ color: "var(--ink-soft)" }}
                itemStyle={{ color: "var(--ink)" }}
                cursor={{ fill: "var(--paper-sunken)" }}
              />
              <Bar
                isAnimationActive={false}
                yAxisId="count"
                name="记录条数"
                dataKey="checkins"
                fill="var(--seal)"
                radius={[2, 2, 0, 0]}
                maxBarSize={24}
              />
              <Line
                isAnimationActive={false}
                yAxisId="hours"
                name="佩戴小时"
                dataKey="hours"
                stroke="var(--moss)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {!entries.length && !sessions.length && (
          <p className="muted">暂无数据。</p>
        )}
      </div>
      <div className="card stat-card heat-card">
        <div className="section-line">
          <h2>记录足迹</h2>
          <span className="muted">最近 12 周</span>
        </div>
        <div className="heat-grid">
          {heat.map((day) => (
            <button
              key={day}
              type="button"
              className={`heat heat-${Math.min(counts[day] ?? 0, 4)}`}
              aria-label={`${day}，${counts[day] ?? 0} 条记录`}
              title={`${day}：${counts[day] ?? 0} 条`}
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
      <div className="card stat-card">
        <div className="section-line">
          <h2>每天的佩戴时长</h2>
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
    </div>
  );
});
