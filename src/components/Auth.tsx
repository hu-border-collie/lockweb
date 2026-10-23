import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { createVault, Vault, db, userError } from "../lib/db";
import type { VaultConfig, QuickUnlockBinding } from "../lib/models";
import {
  readQuickBinding,
  quickCapability,
  unlockWithPassword,
  unlockWithQuickBinding,
  bindingCurrent,
  quickError,
  ensureConfig,
  LOCK_EVENT,
} from "../lib/quickUnlock";
export function Auth({
  config,
  onUnlock,
  error: outerError,
}: {
  config?: VaultConfig;
  onUnlock: (
    vault: Vault,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ) => Promise<void>;
  error?: string;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [quick, setQuick] = useState<QuickUnlockBinding | null>(null),
    [capable, setCapable] = useState(false),
    [checking, setChecking] = useState(true);
  const [now, setNow] = useState(Date.now());
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const cancel = () => controller.current?.abort();
    window.addEventListener(LOCK_EVENT, cancel);
    return () => {
      alive.current = false;
      cancel();
      window.removeEventListener(LOCK_EVENT, cancel);
    };
  }, []);
  useEffect(() => {
    let current = true;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setQuick(null);
    setChecking(true);
    void Promise.all([
      config ? readQuickBinding(config) : Promise.resolve(null),
      quickCapability(),
    ])
      .then(([binding, available]) => {
        if (current) {
          setQuick(binding);
          setCapable(available);
          setChecking(false);
        }
      })
      .catch(() => {
        if (current) {
          setQuick(null);
          setChecking(false);
        }
      });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [config]);
  const start = () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    return c;
  };
  const finish = (c: AbortController) => {
    if (alive.current && controller.current === c) {
      setBusy(false);
      controller.current = null;
    }
  };
  const canQuick =
    !!config &&
    !!quick &&
    capable &&
    bindingCurrent(quick, config, location.origin, location.hostname, now);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = start();
    try {
      if (config) {
        if (attempts >= 5) await new Promise((r) => setTimeout(r, 2000));
        const result = await unlockWithPassword(config, password, c.signal);
        setPassword("");
        await onUnlock(result.vault, c.signal, result.guard);
      } else {
        if (password !== repeat) throw new Error("两次输入的密码不一致。");
        const { key, config: newConfig } = await createVault(
          password,
          db,
          c.signal,
        );
        setPassword("");
        setRepeat("");
        if (c.signal.aborted) return;
        await onUnlock(new Vault(key, newConfig), c.signal, () =>
          ensureConfig(newConfig, db, c.signal),
        );
      }
    } catch (e) {
      if (alive.current && controller.current === c && !c.signal.aborted) {
        setAttempts((a) => a + 1);
        setError(userError(e));
      }
    } finally {
      finish(c);
    }
  }
  return (
    <div className="auth">
      <div className="auth-brand">
        <span className="brand-mark" aria-hidden="true">
          私
        </span>
        <span>私记</span>
      </div>
      <div className="auth-intro">
        <p>
          {config
            ? "输入密码解锁。"
            : "数据加密保存在本机，不需要账号，不会上传。\n设置密码后开始使用。"}
        </p>
      </div>
      <form className="card auth-form" onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <label className="field">
            {config ? "密码" : "设置密码"}
            <input
              type="password"
              autoComplete={config ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={config ? undefined : "至少 8 个字符"}
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
            {busy ? (config ? "正在解锁…" : "正在创建…") : config ? "解锁" : "创建"}
            <ArrowRight size={19} />
          </button>
        </fieldset>
      </form>
      {config && quick && (
        <>
          <button
            type="button"
            className="secondary wide"
            disabled={busy || checking || !canQuick}
            onClick={async () => {
              const c = start();
              try {
                const result = await unlockWithQuickBinding(
                  config,
                  quick,
                  c.signal,
                );
                await onUnlock(result.vault, c.signal, result.guard);
              } catch (e) {
                if (
                  alive.current &&
                  controller.current === c &&
                  !c.signal.aborted
                ) {
                  setError(quickError(e));
                  setPassword("");
                }
              } finally {
                finish(c);
              }
            }}
          >
            面容 / 指纹解锁
          </button>
          <p className="auth-warning">
            {!capable
              ? "此环境不支持系统验证，请输入密码。"
              : !canQuick
                ? "快速解锁已过期，请输入密码。输入后重新开始计算有效期。"
                : "可使用面容、指纹或设备密码解锁。"}
          </p>
        </>
      )}
      {busy && (
        <button
          type="button"
          className="text-button wide"
          onClick={() => {
            controller.current?.abort();
            controller.current = null;
            setBusy(false);
          }}
        >
          取消解锁
        </button>
      )}
      <div className="auth-privacy">
        <ShieldCheck size={18} />
        <span>仅存本机 · 可离线使用 · 不上传</span>
      </div>
      <p className="auth-warning">
        {config
          ? "密码无法找回。更换设备需要用加密备份恢复。"
          : "密码无法找回，忘记后数据无法解密。浏览器可能清理本地数据，请定期导出备份。"}
      </p>
      {config && (
        <button
          className="text-button wide"
          disabled={busy}
          onClick={() => setReset(!reset)}
        >
          忘记密码？
        </button>
      )}
      {reset && (
        <div className="card form-stack">
          <p className="muted">
            只能删除本机数据并重新创建。如有加密备份，可设置新密码后恢复。此操作无法撤销。
          </p>
          <label className="field">
            输入「删除本机数据」确认
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="danger-button"
            disabled={confirmation !== "删除本机数据" || busy}
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
            删除本机数据
          </button>
        </div>
      )}
    </div>
  );
}
