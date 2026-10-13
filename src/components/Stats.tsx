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
import type { Entry, WearSession, JournalSettings } from "../lib/models";
import { insights } from "../lib/journal";
import { ShareCard } from "./ShareCard";
import { summary, dailyWear, dayKey, shiftDay, duration } from "../lib/time";
export function Stats({
  entries,
  sessions,
  now,
  onDay,
  settings,
}: {
  entries: Entry[];
  sessions: WearSession[];
  now: number;
  onDay: (day: string) => void;
  settings: JournalSettings;
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
      <ShareCard entries={entries} sessions={sessions} now={now} />
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
      <div className="card">
        <h2>舒适度与佩戴时长</h2>
        <p className="muted">
          按打卡时已累计的实际佩戴小时分组。仅使用明确关联时段、佩戴中且填写评分的样本；表示记录相关性。
        </p>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={analysis.comfort}>
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--muted)", fontSize: 10 }}
              />
              <YAxis domain={[1, 5]} width={28} />
              <Tooltip />
              <Line
                dataKey="average"
                name="平均舒适度"
                stroke="var(--teal)"
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
              {b.average === null ? "暂无评分" : b.average.toFixed(2)}
            </strong>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>标签与舒适度</h2>
        {analysis.tags.length ? (
          <>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analysis.tags.slice(0, 20)}>
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--muted)", fontSize: 10 }}
                  />
                  <YAxis domain={[0, 5]} width={28} />
                  <Tooltip />
                  <Bar
                    dataKey="average"
                    name="平均舒适度"
                    fill="var(--accent)"
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
                  {t.average === null ? "暂无评分" : t.average.toFixed(2)}
                </strong>
              </div>
            ))}
          </>
        ) : (
          <p className="muted">还没有标签记录</p>
        )}
      </div>
      <div className="card">
        <h2>打卡时间段分布</h2>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analysis.hours}>
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                minTickGap={25}
              />
              <YAxis allowDecimals={false} width={28} />
              <Tooltip />
              <Bar
                dataKey="on"
                stackId="state"
                name="佩戴中"
                fill="var(--accent)"
                isAnimationActive={false}
              />
              <Bar
                dataKey="off"
                stackId="state"
                name="未佩戴"
                fill="var(--teal)"
                isAnimationActive={false}
              />
              <Bar
                dataKey="unspecified"
                stackId="state"
                name="未记录状态"
                fill="var(--muted)"
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card">
        <h2>装备使用对比</h2>
        <p className="muted">
          每款装备内的重叠时段合并，小憩已扣除。不同装备之间的重叠时间不相加为总时长。
        </p>
        {analysis.gears.length ? (
          analysis.gears.map((g, i) => (
            <div className="data-row" key={i}>
              <span>{g.name}</span>
              <strong>
                {g.hours.toFixed(1)} 小时 ·{" "}
                {g.average === null
                  ? "暂无评分"
                  : `${g.average.toFixed(2)} 分（${g.count} 次）`}
              </strong>
            </div>
          ))
        ) : (
          <p className="muted">建立装备档案并关联记录后显示</p>
        )}
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
