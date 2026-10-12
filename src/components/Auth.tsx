import { useState } from "react";
import { LockKeyhole, ShieldCheck, ArrowRight } from "lucide-react";
import { createVault, Vault, db, userError } from "../lib/db";
import { unlockVault } from "../lib/crypto";
import type { VaultConfig } from "../lib/models";
export function Auth({
  config,
  onUnlock,
  error: outerError,
}: {
  config?: VaultConfig;
  onUnlock: (vault: Vault) => Promise<void>;
  error?: string;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [attempts, setAttempts] = useState(0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (config) {
        if (attempts >= 5) await new Promise((r) => setTimeout(r, 2000));
        const key = await unlockVault(config, password);
        setPassword("");
        await onUnlock(new Vault(key, config));
      } else {
        if (password !== repeat) throw new Error("两次输入的密码不同");
        const { key, config: c } = await createVault(password);
        setPassword("");
        setRepeat("");
        await onUnlock(new Vault(key, c));
      }
    } catch (e) {
      setAttempts((a) => a + 1);
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div className="auth-brand">
        <span className="brand-mark">
          <LockKeyhole size={31} strokeWidth={1.6} />
        </span>
        <span>
          私记<small>PRIVATE JOURNAL</small>
        </span>
      </div>
      <div className="auth-intro">
        <span className="eyebrow">照片 · 时间 · 日常</span>
        <h1>
          {config ? "你的记录，\n只向你打开。" : "留住日常，\n留给自己。"}
        </h1>
        <p>
          {config
            ? "输入密码，回到自己的私人空间。"
            : "一个只存在于你设备里的私人空间。\n从设置本地解锁密码开始。"}
        </p>
      </div>
      <form className="card auth-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          {config ? "解锁密码" : "设置解锁密码"}
          <input
            type="password"
            autoComplete={config ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={config ? "输入你的密码" : "至少 8 个字符"}
            required
            minLength={config ? 1 : 8}
          />
        </label>
        {!config && (
          <label className="field">
            确认密码
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
              minLength={8}
            />
          </label>
        )}
        {(error || outerError) && (
          <p className="error" role="alert">
            {error || outerError}
          </p>
        )}
        <button className="primary wide" disabled={busy} type="submit">
          {busy ? "正在解锁…" : config ? "解锁私记" : "创建本地空间"}
          <ArrowRight size={19} />
        </button>
      </form>
      <div className="auth-privacy">
        <ShieldCheck size={18} />
        <span>本机加密 · 离线可用 · 照片不上传</span>
      </div>
      <p className="auth-warning">
        {config
          ? "密码无法找回。若更换设备，请用加密备份恢复。"
          : "请妥善保存密码并定期导出备份。浏览器存储可能被清理，忘记密码无法找回数据。"}
      </p>
      {config && (
        <button className="text-button wide" onClick={() => setReset(!reset)}>
          忘记密码？
        </button>
      )}
      {reset && (
        <div className="card form-stack">
          <p className="muted">
            只能删除本机保险库后重新开始；若有加密备份，可创建新密码后恢复。此操作无法撤销。
          </p>
          <label className="field">
            输入“删除本机保险库”
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="danger-button"
            disabled={confirmation !== "删除本机保险库" || busy}
            onClick={() =>
              void (async () => {
                try {
                  await db.transaction(
                    "rw",
                    db.meta,
                    db.entries,
                    db.sessions,
                    db.photos,
                    async () => {
                      await db.meta.clear();
                      await db.entries.clear();
                      await db.sessions.clear();
                      await db.photos.clear();
                    },
                  );
                  location.reload();
                } catch (e) {
                  setError(userError(e));
                }
              })()
            }
          >
            删除本机保险库
          </button>
        </div>
      )}
    </div>
  );
}
