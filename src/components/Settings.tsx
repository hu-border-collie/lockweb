import { unlockVault } from "../lib/crypto";
import { beginSystemDialog, endSystemDialog } from "../lib/privacy";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ShieldCheck,
  Download,
  Upload,
  Lock,
  HardDrive,
  SunMoon,
  Trash2,
  Info,
  RefreshCw,
  ChevronRight,
  Smartphone,
} from "lucide-react";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { exportBackup, importBackup, type BackupData } from "../lib/backup";
import { Modal } from "./Shared";
import { JournalOptions } from "./JournalOptions";
import { StorageManager } from "./StorageManager";
import { BiometricSettings } from "./BiometricSettings";
import type { JournalSettings } from "../lib/models";
export type Theme = "system" | "light" | "dark";

const PANEL_TITLES: Record<string, string> = {
  export: "导出加密备份",
  import: "从备份恢复",
  password: "更换密码",
  clear: "清空手记",
};

function SettingRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}>
      {icon}
      <span>
        <span className="setting-title">{title}</span>
        <small>{hint}</small>
      </span>
      <ChevronRight
        className="settings-arrow"
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </button>
  );
}

export function Settings({
  vault,
  revision,
  refresh,
  lock,
  theme,
  onTheme,
  offlineReady,
  needRefresh,
  onUpdate,
  settings,
}: {
  vault: Vault;
  revision: number;
  refresh: () => Promise<void>;
  lock: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  offlineReady: boolean;
  needRefresh: boolean;
  onUpdate: () => void;
  settings: JournalSettings;
}) {
  const [panel, setPanel] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<BackupData | null>(null);
  const [parsedRevision, setParsedRevision] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backupReceipt, setBackupReceipt] = useState<{ vault: Vault; revision: number } | null>(null);
  const [backup, setBackup] = useState<{ url: string; file: File; revision: number } | null>(
    null,
  );
  const [usage, setUsage] = useState<{
    used?: number;
    quota?: number;
    persistent?: boolean;
  }>({});
  const [confirmation, setConfirmation] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void estimate();
  }, [revision]);
  useEffect(
    () => () => {
      if (backup) URL.revokeObjectURL(backup.url);
    },
    [backup],
  );
  async function estimate() {
    try {
      const e = await navigator.storage?.estimate?.();
      const p = await navigator.storage?.persisted?.();
      setUsage({ used: e?.usage, quota: e?.quota, persistent: p });
    } catch {
      setUsage({});
    }
  }
  function openPanel(name: string) {
    setPanel(name);
    setPassword("");
    setCurrentPassword("");
    setConfirmPassword("");
    setParsed(null);
    setFile(null);
    setMessage("");
    setError("");
    setConfirmation("");
    setBackup(null);
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy("");
    }
  }
  async function saveBackup() {
    if (!backup) return;
    if (navigator.canShare?.({ files: [backup.file] })) {
      beginSystemDialog();
      try {
        await navigator.share({
          files: [backup.file],
          title: "私记 · 加密备份",
        });
        setBackupReceipt({ vault, revision: backup.revision });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setError("系统分享没能打开，可以用下面的下载链接。");
      } finally {
        endSystemDialog();
      }
    } else {
      beginSystemDialog();
      const a = document.createElement("a");
      a.href = backup.url;
      a.download = backup.file.name;
      a.click();
      setBackupReceipt({ vault, revision: backup.revision });
    }
  }
  const bytes = (n?: number) =>
    n === undefined ? "系统未提供" : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const feedback = (
    <>
      {busy && (
        <p className="muted" role="status">
          {busy}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  return (
    <div className="settings-page">
      <section className="card privacy-card">
        <div className="privacy-emblem" aria-hidden="true">
          <ShieldCheck size={22} strokeWidth={1.5} />
        </div>
        <div className="privacy-copy">
          <h2>隐私与加密</h2>
          <p>
            记录和照片都锁在这台设备里。没有账号，没有上传，没有广告，也没有人跟踪你。
          </p>
        </div>
      </section>
      <h3 className="group-label">隐私与备份</h3>
      <div className="card settings-list">
        <SettingRow
          icon={<Lock size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="现在合上"
          hint="切到后台超过 1 分钟会自动合上"
          onClick={() => lock()}
        />
        <SettingRow
          icon={<ShieldCheck size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="更换密码"
          hint="密码丢了找不回来，记得备份"
          onClick={() => openPanel("password")}
        />
        <SettingRow
          icon={<Download size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="导出一份加密备份"
          hint="照片、缩略图和记录都在里面"
          onClick={() => openPanel("export")}
        />
        <SettingRow
          icon={<Upload size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="用备份恢复"
          hint="先检查，再覆盖现在的记录"
          onClick={() => openPanel("import")}
        />
      </div>
      <h3 className="group-label">设备与偏好</h3>
      <BiometricSettings vault={vault} revision={revision} refresh={refresh} />
      <JournalOptions
        vault={vault}
        settings={settings}
        revision={revision}
        refresh={refresh}
      />
      <StorageManager
        vault={vault}
        revision={revision}
        refresh={refresh}
        backupRevision={backupReceipt?.vault === vault ? backupReceipt.revision : undefined}
        onBackup={() => openPanel("export")}
      />
      <div className="card appearance-card">
        <label className="setting-label">
          <SunMoon size={18} strokeWidth={1.5} aria-hidden="true" />
          <span>外观</span>
          <select
            aria-label="外观"
            value={theme}
            onChange={(e) => onTheme(e.target.value as Theme)}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <div className="storage-info">
          <div className="setting-label">
            <HardDrive size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>本机存储</span>
          </div>
          <p className="storage-usage">
            已使用 {bytes(usage.used)} · 可用配额 {bytes(usage.quota)}
          </p>
          <div className="data-row storage-row">
            <span>长期保留</span>
            <strong>
              {usage.persistent
                ? "系统已经答应长期保留"
                : "还没拿到长期保留的保障"}
            </strong>
          </div>
          <button
            className="secondary"
            onClick={() =>
              void run("正在申请…", async () => {
                const allowed = await navigator.storage?.persist?.();
                await estimate();
                setMessage(
                  allowed
                    ? "已经拿到长期保留，仍请定期备份。"
                    : "系统没有答应，或不支持长期保留，请定期备份。",
                );
              })
            }
          >
            申请长期保留
          </button>
        </div>
      </div>
      <section className="card install-card">
        <div className="install-head">
          <span className="install-mark" aria-hidden="true">
            <Smartphone size={20} strokeWidth={1.5} />
          </span>
          <h2>装到主屏幕</h2>
        </div>
        <p className="install-guide">
          在 iPhone 的 Safari 里打开这一页，点「分享」→「添加到主屏幕」。第一次联网时等缓存完成，就可以断网使用。
        </p>
        <div className={`status-pill ${offlineReady ? "ready" : ""}`}>
          {offlineReady ? "应用已缓存，可以离线使用" : "正在缓存…"}
        </div>
        <p className="install-note">
          装好后请一直从主屏幕打开。同一台设备上，浏览器和主屏幕应用可能是两套存储；换网址、换浏览器或清理网站数据都不会带走记录。
        </p>
        {needRefresh && (
          <button className="secondary" onClick={onUpdate}>
            <RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" />
            更新应用
          </button>
        )}
      </section>
      <div className="storage-warning">
        <Info size={18} strokeWidth={1.5} aria-hidden="true" />
        <p>
          浏览器数据可能被系统清理，不能代替备份。最好每周导出一次，并确认文件已经存进「文件」App。备份之后的记录，要再导一次。
        </p>
      </div>
      <div className="card settings-list danger">
        <SettingRow
          icon={<Trash2 size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="清空这本手记"
          hint="密码和设置会保留"
          onClick={() => openPanel("clear")}
        />
      </div>
      {message && !panel && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && !panel && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {panel && (
        <Modal
          title={PANEL_TITLES[panel] ?? ""}
          onClose={() => {
            if (!busy) setPanel("");
          }}
        >
          <fieldset className="settings-sheet-form" disabled={!!busy}>
            {panel === "export" && (
              <>
                <p className="settings-note">
                  给这份备份单独设一个密码，至少 8 个字符。在任何设备上恢复都要用它。
                </p>
                <div className="settings-fields">
                  <label className="field">
                    备份密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    再次输入备份密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="primary wide"
                  disabled={!!busy}
                  onClick={() =>
                    void run("正在生成备份…", async () => {
                      if (password !== confirmPassword)
                        throw new Error("两次输入的备份密码不一样。");
                      const blob = await exportBackup(vault, password);
                      await vault.assertRevision(revision);
                      const f = new File(
                        [blob],
                        `private-log-${new Date().toISOString().slice(0, 10)}.plog`,
                        { type: "application/octet-stream" },
                      );
                      setBackup({ file: f, url: URL.createObjectURL(blob), revision });
                      setPassword("");
                      setConfirmPassword("");
                      setMessage(
                        "备份已经打包好，点下面保存到「文件」App。",
                      );
                    })
                  }
                >
                  开始打包
                </button>
                {feedback}
                {backup && (
                  <div className="settings-block">
                    <button
                      className="secondary wide"
                      onClick={() => void saveBackup()}
                    >
                      保存备份文件
                    </button>
                    <a
                      className="backup-link"
                      href={backup.url}
                      download={backup.file.name}
                      onClick={() => {
                        beginSystemDialog();
                        setBackupReceipt({ vault, revision: backup.revision });
                      }}
                    >
                      直接下载 {backup.file.name}
                    </a>
                  </div>
                )}
              </>
            )}
            {panel === "import" && (
              <>
                <p className="settings-note">
                  恢复会覆盖现在的记录。检查不通过不会动本地数据，建议先导出一份现有的备份。
                </p>
                <input
                  ref={importRef}
                  className="sr-only"
                  type="file"
                  aria-label="选择备份文件"
                  accept=".plog,application/octet-stream"
                  onChange={(e) => {
                    endSystemDialog();
                    setFile(e.target.files?.[0] ?? null);
                    setParsed(null);
                  }}
                />
                <button
                  className="secondary wide"
                  disabled={!!busy}
                  onClick={() => {
                    beginSystemDialog();
                    importRef.current?.click();
                  }}
                >
                  {file ? file.name : "选择 .plog 备份文件"}
                </button>
                <label className="field">
                  备份密码
                  <input
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setParsed(null);
                    }}
                  />
                </label>
                <button
                  className="primary wide"
                  disabled={!!busy || !file}
                  onClick={() =>
                    void run("正在检查备份…", async () => {
                      if (!file) throw new Error("先选一个备份文件");
                      setParsedRevision(revision);
                      setParsed(await importBackup(file, password));
                    })
                  }
                >
                  检查备份
                </button>
                {feedback}
                {parsed && (
                  <div className="restore-preview">
                    <h3>备份检查通过</h3>
                    <p>
                      {parsed.entries.length} 次记录 · {parsed.photos.length}{" "}
                      张照片 · {parsed.sessions.length} 个时段 ·{" "}
                      {parsed.fate.draws.length} 次轮盘判定
                    </p>
                    <button
                      className="primary wide"
                      disabled={!!busy}
                      onClick={() =>
                        void run("正在恢复…", async () => {
                          await vault.replace(
                            parsed.entries,
                            parsed.sessions,
                            parsed.photos,
                            parsedRevision,
                            parsed.settings,
                            parsed.fate,
                          );
                          await refresh();
                          setParsed(null);
                          setFile(null);
                          setPassword("");
                          setMessage("记录和照片已经完整恢复。");
                        })
                      }
                    >
                      覆盖并恢复
                    </button>
                  </div>
                )}
              </>
            )}
            {panel === "password" && (
              <>
                <div className="settings-fields">
                  <label className="field">
                    当前密码
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    新密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    再次输入新密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="primary wide"
                  disabled={!!busy}
                  onClick={() =>
                    void run("正在修改密码…", async () => {
                      if (password !== confirmPassword)
                        throw new Error("两次新密码不一样。");

                      await unlockVault(vault.config, currentPassword);
                      await vault.changePassword(password, revision);
                      await refresh();
                      setPassword("");
                      setCurrentPassword("");
                      setConfirmPassword("");
                      setMessage("密码已经换好，下次请用新密码。");
                    })
                  }
                >
                  保存新密码
                </button>
                {feedback}
              </>
            )}
            {panel === "clear" && (
              <>
                <p className="settings-warning-text">
                  会删掉全部记录、照片和时段，无法撤销。密码会保留。请先保存一份备份。
                </p>
                <label className="field">
                  输入「清空」确认
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="清空"
                  />
                </label>
                <button
                  className="danger-button wide"
                  disabled={confirmation !== "清空" || !!busy}
                  onClick={() =>
                    void run("正在清空…", async () => {
                      await vault.clear(revision);
                      await refresh();
                      setMessage("这本手记已经清空。");
                      setConfirmation("");
                    })
                  }
                >
                  确认清空
                </button>
                {feedback}
              </>
            )}
          </fieldset>
        </Modal>
      )}
    </div>
  );
}
