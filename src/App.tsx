import { inSystemDialog } from "./lib/privacy";
import { LOCK_EVENT } from "./lib/quickUnlock";
import Dexie from "dexie";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  Home,
  CalendarDays,
  Camera,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  LockKeyhole,
  Plus,
  ArrowUpRight,
  Timer,
  ShieldCheck,
  WifiOff,
  Eye,
  EyeOff,
  ChevronRight,
} from "lucide-react";
import { Auth } from "./components/Auth";
import { Calendar } from "./components/Calendar";
import { Stats } from "./components/Stats";
import { Settings, type Theme } from "./components/Settings";
import { EntryForm } from "./components/EntryForm";
import { SessionForm } from "./components/SessionForm";
import { StealthContext } from "./components/Stealth";
import { defaultSettings, type JournalSettings } from "./lib/models";
import { Photo, RecordCard, Modal, Empty, Viewer } from "./components/Shared";
import { Vault, getConfig, userError } from "./lib/db";
import {
  id,
  type VaultConfig,
  type Entry,
  type WearSession,
} from "./lib/models";
import {
  dayKey,
  duration,
  dateTime,
  clock,
  summary,
  totalWear,
} from "./lib/time";
const NAV = [
  { id: "home", label: "首页", icon: Home },
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "checkin", label: "打卡", icon: Camera },
  { id: "stats", label: "统计", icon: ChartNoAxesCombined },
  { id: "settings", label: "设置", icon: SettingsIcon },
];
export default function App() {
  const [config, setConfig] = useState<VaultConfig | undefined>();
  const [hidden, setHidden] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [vault, setVault] = useState<Vault | null>(null);
  const [fatal, setFatal] = useState("");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("private-log-theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError: (e) =>
      console.warn("Service worker registration failed", e),
  });
  useEffect(() => {
    getConfig()
      .then((c) => {
        setConfig(c);
        setLoaded(true);
      })
      .catch((e) => {
        setFatal(userError(e));
        setLoaded(true);
      });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("private-log-theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then(async () => {
      if (navigator.serviceWorker.controller) setOfflineReady(true);
    });
    const update = () => setOfflineReady(true);
    navigator.serviceWorker.addEventListener("controllerchange", update);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", update);
  }, [setOfflineReady]);
  const lock = useCallback(() => {
    window.dispatchEvent(new Event(LOCK_EVENT));
    setVault(null);
    void getConfig()
      .then(setConfig)
      .catch((e) => setFatal(userError(e)));
  }, []);
  useEffect(() => {
    let hiddenAt = 0;
    const hide = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        setHidden(true);
      } else {
        if (hiddenAt && Date.now() - hiddenAt >= 60000 && !inSystemDialog())
          lock();
        hiddenAt = 0;
        setHidden(false);
      }
    };
    const leave = () => {
      if (!inSystemDialog()) lock();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, [lock]);
  if (!window.isSecureContext || !crypto.subtle)
    return (
      <div className="auth">
        <h1>需要安全连接</h1>
        <p>
          请使用 HTTPS 网站，或在电脑上使用 localhost
          开发服务。不能直接从“文件”App 打开 HTML。
        </p>
      </div>
    );
  if (!loaded)
    return (
      <div className="loading">
        <LockKeyhole />
        <p>正在打开本地空间…</p>
      </div>
    );
  if (!vault)
    return (
      <Auth
        config={config}
        error={fatal}
        onUnlock={async (v, signal, guard) => {
          await v.snapshot();
          await guard?.();
          if (signal.aborted)
            throw new DOMException("操作已取消", "AbortError");
          setConfig(v.config);
          setVault(v);
          setFatal("");
        }}
      />
    );
  return (
    <>
      <div
        className={hidden ? "privacy-cover visible" : "privacy-cover"}
        aria-hidden={!hidden}
      >
        <LockKeyhole />
        <span>私记 · 已隐藏</span>
      </div>
      <Unlocked
        key={vault.config.id}
        vault={vault}
        lock={lock}
        theme={theme}
        onTheme={setTheme}
        offlineReady={offlineReady}
        needRefresh={needRefresh}
        onUpdate={() => {
          if (
            confirm(
              "应用更新会重新打开页面。请先保存正在编辑的内容。现在更新？",
            )
          )
            void updateServiceWorker(true);
        }}
      />
    </>
  );
}
function PrivateShell({
  stealth,
  children,
}: {
  stealth: boolean;
  children: ReactNode;
}) {
  return (
    <StealthContext.Provider value={stealth}>
      <div className="app-shell">{children}</div>
    </StealthContext.Provider>
  );
}
function Unlocked({
  vault,
  lock,
  theme,
  onTheme,
  offlineReady,
  needRefresh,
  onUpdate,
}: {
  vault: Vault;
  lock: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  offlineReady: boolean;
  needRefresh: boolean;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState("home");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<JournalSettings>(defaultSettings);
  const [ready, setReady] = useState(false);
  const [stealth, setStealth] = useState(true);
  const [gearId, setGearId] = useState("");
  const [sessions, setSessions] = useState<WearSession[]>([]);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  const [selected, setSelected] = useState(dayKey(Date.now()));
  const [edit, setEdit] = useState<Entry | null>(null);
  const [sessionModal, setSessionModal] = useState<WearSession | true | null>(
    null,
  );
  const [manage, setManage] = useState(false);
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(
    null,
  );
  const [deletion, setDeletion] = useState<{
    entry?: Entry;
    session?: WearSession;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const snap = await vault.snapshot();
    if (generation !== refreshGeneration.current) return;
    setEntries(snap.entries.sort((a, b) => b.timestamp - a.timestamp));
    setSessions(snap.sessions.sort((a, b) => b.start - a.start));
    setRevision(snap.revision);
    setSettings(snap.settings);
    setReady(true);
  }, [vault]);
  useEffect(() => {
    void refresh().catch((e) => setError(userError(e)));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const sub = () => {
      void refresh().catch((e) => setError(userError(e)));
    };
    Dexie.on("storagemutated", sub);
    return () => {
      refreshGeneration.current++;
      clearInterval(timer);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      Dexie.on("storagemutated").unsubscribe(sub);
    };
  }, [refresh]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(t);
  }, [message]);
  const active = sessions.find((s) => s.end === null);
  useEffect(() => {
    if (gearId && !settings.gears.some((g) => g.id === gearId && !g.archived))
      setGearId("");
  }, [gearId, settings]);
  const paused = active?.breaks?.at(-1)?.end === null;
  const today = entries.filter((e) => dayKey(e.timestamp) === dayKey(now));
  const totals = summary(entries, sessions, now);
  const view = useCallback(
    (ids: string[], index: number) => setViewer({ ids, index }),
    [],
  );
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(userError(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await refresh();
    setEdit(null);
    setTab("home");
    setFormKey((v) => v + 1);
    setMessage("打卡已保存在本机");
  }
  function navigate(t: string) {
    setTab(t);
    setError("");
    window.scrollTo({ top: 0 });
  }
  if (!ready)
    return (
      <div className="auth">
        <p role={error ? "alert" : "status"}>{error || "正在读取记录…"}</p>
        {error && (
          <button
            className="secondary"
            onClick={() => void refresh().catch((e) => setError(userError(e)))}
          >
            重新读取
          </button>
        )}
        <button className="text-button" onClick={lock}>
          锁定应用
        </button>
      </div>
    );
  return (
    <PrivateShell stealth={stealth}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <LockKeyhole size={19} />
          </span>
          <div>
            私记<small>只留给自己</small>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="防窥模式"
            aria-pressed={stealth}
            onClick={() => setStealth((v) => !v)}
          >
            {stealth ? <EyeOff size={21} /> : <Eye size={21} />}
          </button>
          <button className="icon-button" onClick={lock} aria-label="锁定应用">
            <LockKeyhole size={21} />
          </button>
        </div>
      </header>
      {!online && (
        <div className="offline-banner">
          <WifiOff size={14} />
          离线使用中 · 记录仍保存在本机
        </div>
      )}
      <main>
        <div className="page-title">
          <div>
            <span className="eyebrow">
              {tab === "home"
                ? new Intl.DateTimeFormat("zh-CN", {
                    month: "long",
                    day: "numeric",
                    weekday: "long",
                  }).format(now)
                : "YOUR PRIVATE SPACE"}
            </span>
            <h1>
              {
                {
                  home: "今天，留给自己。",
                  calendar: "每一天，都有迹可循。",
                  checkin: "记录这一刻。",
                  stats: "日常，慢慢积累。",
                  settings: "你的空间，由你掌握。",
                }[tab]
              }
            </h1>
          </div>
          {tab === "home" && (
            <span className="local-tag">
              <ShieldCheck size={14} />
              本地加密
            </span>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {tab === "home" && (
          <>
            <section className={`wear-hero ${active ? "active" : ""}`}>
              <div className="hero-top">
                <span className="state-label">
                  <i />
                  {active ? (paused ? "清洁小憩中" : "正在佩戴") : "当前未佩戴"}
                </span>
                <button className="hero-link" onClick={() => setManage(true)}>
                  时段管理
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <p className="hero-caption">
                {active ? "本次已持续" : "按自己的节奏记录"}
              </p>
              <div className="wear-timer">
                {active ? duration(totalWear([active], now), true) : "自由时刻"}
              </div>
              <p className="hero-start">
                {active
                  ? `${dateTime(active.start)} 开始`
                  : "佩戴时段和拍照打卡独立保存"}
              </p>
              <button
                className="hero-action"
                disabled={busy || !ready}
                onClick={() =>
                  void run(async () => {
                    if (active) {
                      const end = Date.now();
                      await vault.saveSession(
                        {
                          ...active,
                          end,
                          breaks: active.breaks?.map((b) =>
                            b.end === null ? { ...b, end } : b,
                          ),
                        },
                        revision,
                      );
                      setMessage("本次佩戴已结束");
                    } else {
                      await vault.saveSession(
                        {
                          id: id(),
                          start: Date.now(),
                          end: null,
                          note: "",
                          ...(gearId ? { gearId } : {}),
                        },
                        revision,
                      );
                      setMessage("已开始记录佩戴时间");
                    }
                  })
                }
              >
                {active ? "结束本次佩戴" : "开始佩戴"}
                {active ? <Timer size={18} /> : <Plus size={19} />}
              </button>
              {!active && settings.gears.some((g) => !g.archived) && (
                <label className="field">
                  本次佩戴装备
                  <select
                    value={gearId}
                    onChange={(e) => setGearId(e.target.value)}
                  >
                    <option value="">不选择装备</option>
                    {settings.gears
                      .filter((g) => !g.archived)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {active && (
                <>
                  <button
                    className="secondary wide"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const timestamp = Date.now();
                        await vault.saveSession(
                          {
                            ...active,
                            breaks: paused
                              ? active.breaks!.map((b, i) =>
                                  i === active.breaks!.length - 1
                                    ? { ...b, end: timestamp }
                                    : b,
                                )
                              : [
                                  ...(active.breaks ?? []),
                                  { start: timestamp, end: null },
                                ],
                          },
                          revision,
                        );
                      })
                    }
                  >
                    {paused ? "恢复佩戴" : "清洁小憩"}
                  </button>
                  {paused && (
                    <p className="hero-start">
                      小憩已持续{" "}
                      {duration(now - active.breaks!.at(-1)!.start, true)} ·
                      此段时间不计入佩戴
                    </p>
                  )}
                </>
              )}
            </section>
            <div className="home-metrics">
              <div>
                <span>今日打卡</span>
                <strong>
                  {today.length}
                  <small> 次</small>
                </strong>
              </div>
              <div>
                <span>最近一次</span>
                <strong className="time-metric">
                  {entries.length ? clock(entries[0].timestamp) : "—"}
                  <small>
                    {entries.length
                      ? dayKey(entries[0].timestamp) === dayKey(now)
                        ? " 今天"
                        : " " + dayKey(entries[0].timestamp).slice(5)
                      : " 尚未打卡"}
                  </small>
                </strong>
              </div>
              <div>
                <span>连续打卡</span>
                <strong>
                  {totals.current}
                  <small> 天</small>
                </strong>
              </div>
            </div>
            <button
              className="quick-capture"
              onClick={() => navigate("checkin")}
            >
              <span>
                <Camera size={25} />
              </span>
              <div>
                <strong>拍照打卡</strong>
                <small>拍一张，或选几张。保存就好。</small>
              </div>
              <ChevronRight size={19} />
            </button>
            <div className="section-line">
              <h2>最近的照片</h2>
              <button
                className="text-button"
                onClick={() => navigate("calendar")}
              >
                查看全部
                <ChevronRight size={14} />
              </button>
            </div>
            {entries.length ? (
              <div className="recent-grid">
                {entries
                  .flatMap((e) => e.photoIds.map((p) => ({ p, e })))
                  .slice(0, 6)
                  .map(({ p, e }) => (
                    <div key={p}>
                      <Photo
                        id={p}
                        vault={vault}
                        onClick={() => view(e.photoIds, e.photoIds.indexOf(p))}
                      />
                      <span>{dateTime(e.timestamp)}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="card">
                <Empty
                  title="从第一张照片开始"
                  detail="日常的每一个瞬间，都值得被自己记住。"
                />
              </div>
            )}
            <div className="section-line">
              <h2>今日记录</h2>
              <span className="muted">{today.length} 次</span>
            </div>
            {today.length ? (
              today.map((e) => (
                <RecordCard
                  key={e.id}
                  entry={e}
                  vault={vault}
                  onEdit={setEdit}
                  onView={view}
                />
              ))
            ) : (
              <p className="muted empty-line">今天的记录会出现在这里。</p>
            )}
          </>
        )}
        {tab === "calendar" && (
          <Calendar
            entries={entries}
            vault={vault}
            selected={selected}
            onSelect={setSelected}
            onEdit={setEdit}
            onView={view}
          />
        )}{" "}
        {tab === "checkin" && (
          <div className="card">
            <EntryForm
              key={formKey}
              vault={vault}
              revision={revision}
              wearing={!!active && !paused}
              sessions={sessions}
              settings={settings}
              active={paused ? undefined : active}
              onSave={save}
              onCancel={() => navigate("home")}
            />
          </div>
        )}
        {tab === "stats" && (
          <Stats
            entries={entries}
            sessions={sessions}
            now={now}
            settings={settings}
            onDay={(day) => {
              setSelected(day);
              navigate("calendar");
            }}
          />
        )}
        {tab === "settings" && (
          <Settings
            vault={vault}
            revision={revision}
            refresh={refresh}
            lock={lock}
            theme={theme}
            onTheme={onTheme}
            offlineReady={offlineReady}
            needRefresh={needRefresh}
            onUpdate={onUpdate}
            settings={settings}
          />
        )}
        <footer className="page-footer">
          <ShieldCheck size={13} />
          本地空间 · 只有你能打开
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="主导航">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`${tab === n.id ? "selected" : ""} ${n.id === "checkin" ? "capture-nav" : ""}`}
            onClick={() => navigate(n.id)}
            aria-current={tab === n.id ? "page" : undefined}
          >
            <span>
              <n.icon size={22} strokeWidth={1.8} />
            </span>
            <small>{n.label}</small>
          </button>
        ))}
      </nav>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
      {edit && (
        <Modal title="编辑打卡" onClose={() => setEdit(null)}>
          <EntryForm
            entry={edit}
            vault={vault}
            revision={revision}
            wearing={!!active && !paused}
            sessions={sessions}
            settings={settings}
            active={paused ? undefined : active}
            onSave={save}
            onCancel={() => setEdit(null)}
            onDelete={(e) => setDeletion({ entry: e })}
          />
        </Modal>
      )}
      {manage && (
        <Modal title="佩戴时段" onClose={() => setManage(false)}>
          <button
            className="primary wide"
            onClick={() => {
              setManage(false);
              setSessionModal(true);
            }}
          >
            <Plus size={18} />
            补录佩戴时段
          </button>
          <p className="muted">可编辑开始与结束时间，重叠时间不会重复统计。</p>
          {sessions.length ? (
            sessions.map((s) => (
              <button
                key={s.id}
                className="session-row"
                onClick={() => {
                  setManage(false);
                  setSessionModal(s);
                }}
              >
                <span>
                  <strong>{dateTime(s.start)}</strong>
                  <small>{s.end ? `至 ${dateTime(s.end)}` : "正在佩戴"}</small>
                  {s.note && <small>{s.note}</small>}
                </span>
                <span>
                  {duration(totalWear([s], now))}
                  <ChevronRight size={16} />
                </span>
              </button>
            ))
          ) : (
            <Empty
              title="还没有佩戴时段"
              detail="开始佩戴或补录时段后，可以在这里管理。"
              icon={<Timer />}
            />
          )}
        </Modal>
      )}
      {sessionModal && (
        <Modal
          title={sessionModal === true ? "补录佩戴时段" : "编辑佩戴时段"}
          onClose={() => setSessionModal(null)}
        >
          <SessionForm
            session={sessionModal === true ? undefined : sessionModal}
            vault={vault}
            revision={revision}
            settings={settings}
            onSave={async () => {
              await refresh();
              setSessionModal(null);
              setMessage("佩戴时段已保存");
            }}
            onDelete={(s) => setDeletion({ session: s })}
          />
        </Modal>
      )}
      {deletion && (
        <Modal title="确认删除" onClose={() => setDeletion(null)}>
          <p>
            {deletion.entry
              ? "这次打卡及其所有照片将永久删除。"
              : "这个佩戴时段将永久删除；拍照打卡仍会保留。"}
          </p>
          <button
            className="danger-button wide"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (deletion.entry)
                  await vault.deleteEntry(deletion.entry, revision);
                else if (deletion.session)
                  await vault.deleteSession(deletion.session.id, revision);
                setDeletion(null);
                setEdit(null);
                setSessionModal(null);
                setMessage("已删除");
              })
            }
          >
            确认删除
          </button>
        </Modal>
      )}
      {viewer && (
        <Viewer
          ids={viewer.ids}
          index={viewer.index}
          vault={vault}
          onClose={() => setViewer(null)}
        />
      )}
    </PrivateShell>
  );
}

