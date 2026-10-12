import { unlockVault } from "../lib/crypto";
import { beginSystemDialog, endSystemDialog } from "../lib/privacy";
import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import { exportBackup, importBackup, type BackupData } from "../lib/backup";
import { Modal } from "./Shared";
export type Theme = "system" | "light" | "dark";
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
}) {
  const [panel, setPanel] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<BackupData | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backup, setBackup] = useState<{ url: string; file: File } | null>(
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
        await navigator.share({ files: [backup.file], title: "私记加密备份" });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setError("系统分享失败，可使用下面的下载链接。");
      } finally {
        endSystemDialog();
      }
    } else {
      beginSystemDialog();
      const a = document.createElement("a");
      a.href = backup.url;
      a.download = backup.file.name;
      a.click();
    }
  }
  const bytes = (n?: number) =>
    n === undefined ? "系统未提供" : `${(n / 1024 / 1024).toFixed(1)} MB`;
  return (
    <>
      <div className="card privacy-card">
        <div className="privacy-emblem">
          <ShieldCheck size={24} />
        </div>
        <div>
          <h2>只属于你</h2>
          <p>
            记录和照片在本机加密保存。
            <br />
            没有账号、上传、广告或追踪。
          </p>
        </div>
      </div>
      <h3 className="group-label">隐私与备份</h3>
      <div className="card settings-list">
        <button onClick={() => lock()}>
          <Lock />
          <span>
            立即锁定<small>后台超过 1 分钟自动锁定</small>
          </span>
        </button>
        <button onClick={() => openPanel("password")}>
          <ShieldCheck />
          <span>
            修改解锁密码<small>密码丢失无法找回，请保存好备份</small>
          </span>
        </button>
        <button onClick={() => openPanel("export")}>
          <Download />
          <span>
            导出加密备份<small>包含全部照片、缩略图和记录</small>
          </span>
        </button>
        <button onClick={() => openPanel("import")}>
          <Upload />
          <span>
            从备份恢复<small>先验证，再确认覆盖现有记录</small>
          </span>
        </button>
      </div>
      <h3 className="group-label">设备与外观</h3>
      <div className="card">
        <label className="setting-label">
          <SunMoon size={20} />
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
          <div>
            <HardDrive size={20} />
            <strong>本地存储</strong>
          </div>
          <p>
            已使用 {bytes(usage.used)} · 可用配额 {bytes(usage.quota)}
          </p>
          <p>
            {usage.persistent ? "系统已允许持久存储" : "尚未获得持久存储保障"}
          </p>
          <button
            className="secondary"
            onClick={() =>
              void run("正在申请…", async () => {
                const allowed = await navigator.storage?.persist?.();
                await estimate();
                setMessage(
                  allowed
                    ? "持久存储已允许，仍请定期备份。"
                    : "系统未允许或不支持持久存储，请定期备份。",
                );
              })
            }
          >
            申请持久存储
          </button>
        </div>
      </div>
      <div className="card install-card">
        <h2>
          <Info size={20} />
          安装与离线
        </h2>
        <p>
          在 iPhone Safari 中打开此页面，点“分享” →
          “添加到主屏幕”。首次联网等待资源缓存完成，再尝试断网。
        </p>
        <div className={`status-pill ${offlineReady ? "ready" : ""}`}>
          {offlineReady ? "应用资源已缓存，可离线使用" : "等待离线缓存完成"}
        </div>
        <p>
          安装后请从主屏幕持续使用。同一设备的浏览器与主屏幕应用可能使用不同存储；换网址、换浏览器或清理网站数据不会自动迁移记录。
        </p>
        {needRefresh && (
          <button className="secondary" onClick={onUpdate}>
            <RefreshCw size={16} />
            更新应用
          </button>
        )}
      </div>
      <div className="storage-warning">
        <Info size={18} />
        <p>
          浏览器存储可能被系统清理，不能代替备份。建议每周导出一次，并确认备份文件已保存到“文件”App。普通备份不能找回备份之后的记录。
        </p>
      </div>
      <div className="card settings-list danger">
        <button onClick={() => openPanel("clear")}>
          <Trash2 />
          <span>
            清空所有记录与照片<small>保留当前密码和应用设置</small>
          </span>
        </button>
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
          title={
            {
              export: "加密备份",
              import: "恢复备份",
              password: "修改密码",
              clear: "清空数据",
            }[panel] ?? ""
          }
          onClose={() => {
            if (!busy) setPanel("");
          }}
        >
          <div className="form-stack">
            {panel === "export" && (
              <>
                <p className="muted">
                  为此备份设置独立密码（至少 8
                  个字符）。任何设备恢复都需要这个密码。
                </p>
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
                <button
                  className="primary wide"
                  disabled={!!busy}
                  onClick={() =>
                    void run("正在生成备份…", async () => {
                      if (password !== confirmPassword)
                        throw new Error("两次输入的备份密码不同");
                      const blob = await exportBackup(vault, password);
                      const f = new File(
                        [blob],
                        `private-log-${new Date().toISOString().slice(0, 10)}.plog`,
                        { type: "application/octet-stream" },
                      );
                      setBackup({ file: f, url: URL.createObjectURL(blob) });
                      setPassword("");
                      setConfirmPassword("");
                      setMessage("备份已生成，请点下方按钮保存到“文件”App。");
                    })
                  }
                >
                  生成加密备份
                </button>
                {backup && (
                  <>
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
                    >
                      直接下载 {backup.file.name}
                    </a>
                  </>
                )}
              </>
            )}
            {panel === "import" && (
              <>
                <p className="muted">
                  恢复会覆盖当前记录。验证失败不会更改本地数据。建议先导出现有备份。
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
                    void run("正在验证备份…", async () => {
                      if (!file) throw new Error("请选择备份");
                      setParsed(await importBackup(file, password));
                    })
                  }
                >
                  验证备份
                </button>
                {parsed && (
                  <div className="restore-preview">
                    <h3>备份验证通过</h3>
                    <p>
                      {parsed.entries.length} 次打卡 · {parsed.photos.length}{" "}
                      张照片 · {parsed.sessions.length} 个佩戴时段
                    </p>
                    <button
                      className="primary wide"
                      disabled={!!busy}
                      onClick={() =>
                        void run("正在加密恢复…", async () => {
                          await vault.replace(
                            parsed.entries,
                            parsed.sessions,
                            parsed.photos,
                            revision,
                          );
                          await refresh();
                          setParsed(null);
                          setFile(null);
                          setPassword("");
                          setMessage("记录与照片已完整恢复。");
                        })
                      }
                    >
                      确认覆盖恢复
                    </button>
                  </div>
                )}
              </>
            )}
            {panel === "password" && (
              <>
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
                <button
                  className="primary wide"
                  disabled={!!busy}
                  onClick={() =>
                    void run("正在修改密码…", async () => {
                      if (password !== confirmPassword)
                        throw new Error("两次新密码不同");

                      await unlockVault(vault.config, currentPassword);
                      await vault.changePassword(password, revision);
                      await refresh();
                      setPassword("");
                      setCurrentPassword("");
                      setConfirmPassword("");
                      setMessage("密码已修改，下次解锁请使用新密码。");
                    })
                  }
                >
                  保存新密码
                </button>
              </>
            )}
            {panel === "clear" && (
              <>
                <p>
                  这会删除全部打卡、照片和佩戴时段，无法撤销。密码会保留。请先保存备份。
                </p>
                <label className="field">
                  请输入“清空”确认
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
                      setMessage("全部记录与照片已清空。");
                      setConfirmation("");
                    })
                  }
                >
                  确认清空数据
                </button>
              </>
            )}
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
          </div>
        </Modal>
      )}
    </>
  );
}
