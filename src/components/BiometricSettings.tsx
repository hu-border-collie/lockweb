import { useEffect, useRef, useState } from "react";
import type { Vault } from "../lib/db";
import {
  QUICK_UNLOCK_META,
  type QuickUnlockBinding,
  type QuickUnlockWindowHours,
} from "../lib/models";
import {
  authorizeQuickEnrollment,
  createQuickCredential,
  finishQuickEnrollment,
  readQuickBinding,
  quickCapability,
  quickError,
  reuseQuickCredential,
  LOCK_EVENT,
  type PasswordGrant,
  type PendingQuickUnlock,
} from "../lib/quickUnlock";
import { dateTime } from "../lib/time";
import { Modal } from "./Shared";

export function BiometricSettings({
  vault,
  revision,
  refresh,
}: {
  vault: Vault;
  revision: number;
  refresh: () => Promise<void>;
}) {
  const [binding, setBinding] = useState<QuickUnlockBinding | null>(null),
    [exists, setExists] = useState(false),
    [loaded, setLoaded] = useState(false),
    [capable, setCapable] = useState<boolean | null>(null);
  const [panel, setPanel] = useState(false),
    [password, setPassword] = useState(""),
    [hours, setHours] = useState<QuickUnlockWindowHours>(0),
    [grant, setGrant] = useState<PasswordGrant | null>(null),
    [pending, setPending] = useState<PendingQuickUnlock | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
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
    setLoaded(false);
    void Promise.all([
      readQuickBinding(vault.config, vault.database),
      vault.database.meta.get(QUICK_UNLOCK_META),
    ])
      .then(([b, raw]) => {
        if (current) {
          setBinding(b);
          setExists(!!raw);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) {
          setError(quickError(e));
          setLoaded(false);
        }
      });
    return () => {
      current = false;
    };
  }, [vault, revision]);
  useEffect(() => {
    let current = true;
    void quickCapability().then((value) => {
      if (current) setCapable(value);
    });
    return () => {
      current = false;
    };
  }, []);
  const start = () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    setMessage("");
    return c;
  };
  const finish = (c: AbortController) => {
    if (alive.current && controller.current === c) {
      setBusy(false);
      controller.current = null;
    }
  };
  const fail = (e: unknown, c: AbortController) => {
    if (alive.current && controller.current === c && !c.signal.aborted)
      setError(quickError(e));
  };
  function close() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setPanel(false);
    setPassword("");
    setGrant(null);
    setPending(null);
  }
  return (
    <>
      <h3 className="group-label">快速解锁</h3>
      <div className="card">
        <h2>面容 / 指纹与设备验证</h2>
        <p className="muted">
          由系统通行密钥验证身份，再解开本地数据密钥。系统可能使用 Face
          ID、Touch ID
          或设备密码；通行密钥可能随系统账户同步。应用不读取生物信息、不上传记录。
        </p>
        <p className="muted">
          {!loaded
            ? "正在读取本地绑定…"
            : binding
              ? binding.expiresAt === null
                ? "已绑定 · 永久有效"
                : `已绑定 · 有效期 ${binding.windowHours < 24 ? `${binding.windowHours} 小时` : `${binding.windowHours / 24} 天`} · ${dateTime(binding.expiresAt)} 到期`
              : exists
                ? "本地绑定已失效，可清除或重新启用。"
                : "尚未启用"}
        </p>
        <p className="muted">
          {capable === null
            ? "正在检查系统验证能力…"
            : capable
              ? "此设备可尝试启用，验证成功后才会保存本地绑定。"
              : "当前环境无法使用系统快速解锁，密码解锁仍可用。"}
        </p>
        <button
          className="secondary"
          disabled={!loaded || !capable || busy}
          onClick={() => {
            setPanel(true);
            setPassword("");
            setGrant(null);
            setPending(null);
            setHours(binding?.windowHours ?? 0);
            setError("");
            setMessage("");
          }}
        >
          {binding ? "重新验证或调整有效期" : "启用快速解锁"}
        </button>
        {exists && (
          <button
            className="danger-text wide"
            disabled={!loaded || busy}
            onClick={async () => {
              const c = start();
              try {
                await vault.disableQuickUnlock(revision);
                await refresh();
                if (alive.current)
                  setMessage(
                    "本地快速解锁已停用。系统保存的通行密钥可在系统密码设置中手动删除。",
                  );
              } catch (e) {
                fail(e, c);
              } finally {
                finish(c);
              }
            }}
          >
            停用本地快速解锁
          </button>
        )}
        {!panel && error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!panel && message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
      </div>
      {panel && (
        <Modal title="启用快速解锁" onClose={close}>
          <fieldset className="form-stack" disabled={busy}>
            <p className="muted">
              默认永久有效，每次解锁仍需系统验证。若选择限时窗口，每次输入正确主密码会重新开始计时，快速解锁本身不会延长窗口。取消任意一步均不改变现有绑定；修改密码、清空或覆盖恢复会撤销本地绑定。
            </p>
            {!grant && (
              <>
                <label className="field">
                  快速解锁有效期
                  <select
                    value={hours}
                    onChange={(e) =>
                      setHours(Number(e.target.value) as QuickUnlockWindowHours)
                    }
                  >
                    <option value={0}>永久有效</option>
                    {binding?.windowHours === 1 && (
                      <option value={1}>1 小时（原设置）</option>
                    )}
                    {binding?.windowHours === 12 && (
                      <option value={12}>12 小时（原设置）</option>
                    )}
                    <option value={24}>1 天</option>
                    <option value={168}>7 天</option>
                    <option value={720}>30 天</option>
                  </select>
                </label>
                <label className="field">
                  确认当前主密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button
                  className="primary wide"
                  disabled={!password}
                  onClick={async () => {
                    const c = start(),
                      input = password;
                    setPassword("");
                    try {
                      const g = await authorizeQuickEnrollment(
                        vault,
                        input,
                        c.signal,
                      );
                      if (alive.current && !c.signal.aborted) {
                        setGrant(g);
                        if (binding)
                          setPending(reuseQuickCredential(g, binding, hours));
                      }
                    } catch (e) {
                      fail(e, c);
                    } finally {
                      finish(c);
                    }
                  }}
                >
                  确认密码继续
                </button>
              </>
            )}
            {grant && (
              <>
                <p className="success">主密码已确认（5 分钟内有效）</p>
                {!pending && (
                  <button
                    className="primary wide"
                    onClick={async () => {
                      const c = start();
                      try {
                        const p = await createQuickCredential(
                          grant,
                          hours,
                          c.signal,
                        );
                        if (alive.current && !c.signal.aborted) setPending(p);
                      } catch (e) {
                        fail(e, c);
                      } finally {
                        finish(c);
                      }
                    }}
                  >
                    创建快速解锁通行密钥
                  </button>
                )}
                {pending && (
                  <>
                    <p className="muted">
                      通行密钥已准备好。再次完成系统验证，确认能派生密钥后才启用。
                    </p>
                    <button
                      className="primary wide"
                      onClick={async () => {
                        const c = start();
                        try {
                          await finishQuickEnrollment(vault, pending, c.signal);
                          await refresh();
                          if (alive.current && !c.signal.aborted) {
                            setPanel(false);
                            setGrant(null);
                            setPending(null);
                            setMessage(
                              "快速解锁已启用，下次锁定后可使用系统验证。",
                            );
                          }
                        } catch (e) {
                          fail(e, c);
                        } finally {
                          finish(c);
                        }
                      }}
                    >
                      验证并启用快速解锁
                    </button>
                  </>
                )}
                {binding && (
                  <button
                    className="secondary wide"
                    onClick={async () => {
                      const c = start();
                      try {
                        const p = await createQuickCredential(
                          grant,
                          hours,
                          c.signal,
                        );
                        if (alive.current && !c.signal.aborted) setPending(p);
                      } catch (e) {
                        fail(e, c);
                      } finally {
                        finish(c);
                      }
                    }}
                  >
                    改用新通行密钥
                  </button>
                )}
                <button
                  className="text-button wide"
                  onClick={() => {
                    setGrant(null);
                    setPending(null);
                    setError("");
                  }}
                >
                  重新确认主密码
                </button>
              </>
            )}
            {busy && (
              <p role="status" className="muted">
                正在验证…
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </fieldset>
          <button className="text-button wide" onClick={close}>
            取消设置
          </button>
        </Modal>
      )}
    </>
  );
}
