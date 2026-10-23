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
  clear: "清空所有记录",
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
  const bytes = (n?: number) => {
    if (n === undefined) return "系统未提供";
    const mb = n / 1024 / 1024;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
  };
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
            记录和照片加密保存在本机。没有账号，不上传数据，没有广告和跟踪。
          </p>
        </div>
      </section>
      <h3 className="group-label">隐私与备份</h3>
      <div className="card settings-list">
        <SettingRow
          icon={<Lock size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="立即锁定"
          hint="切到后台超过 1 分钟自动锁定"
          onClick={() => lock()}
        />
        <SettingRow
          icon={<ShieldCheck size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="更换密码"
          hint="密码无法找回，请保留备份"
          onClick={() => openPanel("password")}
        />
        <SettingRow
          icon={<Download size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="导出加密备份"
          hint="包含全部照片、缩略图和记录"
          onClick={() => openPanel("export")}
        />
        <SettingRow
          icon={<Upload size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="从备份恢复"
          hint="先校验，再覆盖当前数据"
          onClick={() => openPanel("import")}
        />
      </div>
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
            <span>持久存储</span>
            <strong>
              {usage.persistent
                ? "已获得持久存储"
                : "未获得持久存储"}
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
                    ? "已获得持久存储，仍需定期备份"
                    : "系统未授予持久存储，请定期备份",
                );
              })
            }
          >
            申请持久存储
          </button>
        </div>
      </div>
      <section className="card install-card">
        <div className="install-head">
          <span className="install-mark" aria-hidden="true">
            <Smartphone size={20} strokeWidth={1.5} />
          </span>
          <h2>添加到主屏幕</h2>
        </div>
        <p className="install-guide">
          在 iPhone Safari 中打开此页，点「分享」→「添加到主屏幕」。首次联网缓存完成后可离线使用。
        </p>
        <div className={`status-pill ${offlineReady ? "ready" : ""}`}>
          {offlineReady ? "已缓存，可离线使用" : "正在缓存…"}
        </div>
        <p className="install-note">
          安装后请始终从主屏幕打开。浏览器和主屏幕应用的存储可能互相独立；更换网址、浏览器或清理网站数据不会迁移记录。
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
          浏览器存储可能被系统清理，不能代替备份。建议每周导出一次并保存到「文件」App。备份只包含导出时的数据。
        </p>
      </div>
      <div className="card settings-list danger">
        <SettingRow
          icon={<Trash2 size={18} strokeWidth={1.5} aria-hidden="true" />}
          title="清空所有记录"
          hint="保留密码和设置"
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
                  为备份单独设置密码（至少 8 个字符），恢复时需要。
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
                        throw new Error("两次输入的备份密码不一致。");
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
                        "备份已生成，点击下方按钮保存到「文件」App。",
                      );
                    })
                  }
                >
                  生成备份
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
                  恢复会覆盖当前数据。校验失败不会改动本机数据。建议先导出当前备份。
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
                    void run("正在校验…", async () => {
                      if (!file) throw new Error("请选择备份文件");
                      setParsedRevision(revision);
                      setParsed(await importBackup(file, password));
                    })
                  }
                >
                  校验备份
                </button>
                {feedback}
                {parsed && (
                  <div className="restore-preview">
                    <h3>校验通过</h3>
                    <p>
                      {parsed.entries.length} 条记录 · {parsed.photos.length}{" "}
                      张照片 · {parsed.sessions.length} 个时段 ·{" "}
                      {parsed.fate.draws.length} 次轮盘结果
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
                          setMessage("已恢复全部记录和照片。");
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
                        throw new Error("两次新密码不一致。");

                      await unlockVault(vault.config, currentPassword);
                      await vault.changePassword(password, revision);
                      await refresh();
                      setPassword("");
                      setCurrentPassword("");
                      setConfirmPassword("");
                      setMessage("密码已更换。");
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
                  将删除全部记录、照片和时段，无法撤销。密码和设置保留。请先导出备份。
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
                      setMessage("已清空所有记录。");
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
