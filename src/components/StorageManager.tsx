import { useEffect, useRef, useState } from "react";
import type { Vault } from "../lib/db";
import { userError } from "../lib/db";
import {
  archiveCutoff,
  archivePhotos,
  planArchive,
  type ArchiveMode,
  type ArchivePlan,
  type ArchiveProgress,
} from "../lib/storage";
import { Modal } from "./Shared";

export function StorageManager({
  vault,
  revision,
  refresh,
  backupRevision,
  onBackup,
}: {
  vault: Vault;
  revision: number;
  refresh: () => Promise<void>;
  backupRevision?: number;
  onBackup: () => void;
}) {
  const [analysis, setAnalysis] = useState<{
    revision: number;
    months: Awaited<ReturnType<Vault["storageAnalysis"]>>;
  } | null>(null);
  const [months, setMonths] = useState<6 | 12>(6);
  const [mode, setMode] = useState<ArchiveMode>("compressed");
  const [plan, setPlan] = useState<ArchivePlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<ArchiveProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [vault]);
  useEffect(() => {
    // Our own commits also refresh the parent's revision via storagemutated.
    // The running batch validates its expected revision before every write;
    // only explicit stop/unmount aborts it. External writes fail that check.
    if (controller.current) return;
    setPlan(null);
    setConfirmed(false);
  }, [revision, vault]);
  const validBackup = backupRevision === revision;
  const validAnalysis = analysis?.revision === revision;
  async function analyze() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await vault.storageAnalysis();
      await vault.assertRevision(revision);
      if (mounted.current) setAnalysis({ revision, months: result });
    } catch (e) {
      if (mounted.current) setError(userError(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    setError("");
    setMessage("");
    setConfirmed(false);
    try {
      const next = await planArchive(vault, archiveCutoff(months), mode);
      if (next.revision !== revision)
        throw new Error("数据已改变，请刷新并重新备份");
      if (mounted.current) {
        setPlan(next);
        setProgress(null);
      }
    } catch (e) {
      if (mounted.current) setError(userError(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function execute() {
    if (!plan || !validBackup || !confirmed || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await archivePhotos(
        vault,
        plan,
        { vaultId: vault.config.id, revision: backupRevision! },
        abort.signal,
        (p) => {
          if (mounted.current) setProgress(p);
        },
      );
      if (mounted.current)
        setMessage(
          `归档完成：处理 ${result.processed} 张，缩小 ${result.changed} 张，释放 ${(result.saved / 1024 / 1024).toFixed(2)} MB。`,
        );
    } catch (e) {
      if (mounted.current)
        setError(
          abort.signal.aborted
            ? "归档已停止，已提交的照片会保留，其余照片没有改变。"
            : `${userError(e)}。已提交的照片会保留，其余照片没有改变。`,
        );
    } finally {
      controller.current = null;
      if (mounted.current) {
        setPlan(null);
        setConfirmed(false);
        setAnalysis(null);
        try {
          await refresh();
        } catch (e) {
          if (mounted.current) setError(userError(e));
        }
        if (mounted.current) setBusy(false);
      }
    }
  }
  const total = analysis?.months.reduce((sum, m) => sum + m.bytes, 0) ?? 0;
  return (
    <section className="card journal-storage">
      <h2>照片存储分析</h2>
      <p className="journal-storage-note">
        按记录月份统计加密大图和缩略图的字节数，不包含索引和应用缓存。
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void analyze()}
      >
        {busy && !plan ? "正在算…" : "分析照片占用"}
      </button>
      {analysis && !validAnalysis && (
        <p className="muted">数据已变化，请重新分析。</p>
      )}
      {analysis && validAnalysis && (
        <div className="settings-block">
          <p className="muted">本次分析结果 · 数据变化后请重新分析</p>
          {analysis.months.length ? (
            <div className="storage-months">
              {analysis.months.map((m) => (
                <div className="storage-month" key={m.month}>
                  <div className="data-row storage-row">
                    <span>
                      {m.month} · {m.count} 张
                    </span>
                    <strong>{(m.bytes / 1024 / 1024).toFixed(2)} MB</strong>
                  </div>
                  <meter
                    aria-label={`${m.month} 照片占用`}
                    min={0}
                    max={Math.max(1, total)}
                    value={m.bytes}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">还没有照片</p>
          )}
        </div>
      )}
      <div className="settings-block">
        <h3>历史照片归档</h3>
        <p className="settings-note">
          先导出并保存完整的 .plog
          加密备份。归档会覆盖本机大图，无法在本机撤销；可用归档前的备份覆盖恢复。
        </p>
        <button className="secondary" disabled={busy} onClick={onBackup}>
          先导出完整备份
        </button>
        <p className="settings-hint">
          {validBackup
            ? "当前版本的备份已生成并发起保存。继续前请确认文件确实已存好。"
            : "生成备份后还要点保存或下载；数据变化后需要重新导出。"}
        </p>
        <fieldset className="settings-sheet-form" disabled={busy}>
          <label className="field">
            归档范围
            <select
              value={months}
              onChange={(e) => {
                setMonths(Number(e.target.value) as 6 | 12);
                setPlan(null);
              }}
            >
              <option value={6}>6 个月以前</option>
              <option value={12}>1 年以前</option>
            </select>
          </label>
          <label className="field">
            归档方式
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as ArchiveMode);
                setPlan(null);
              }}
            >
              <option value="compressed">
                低损压缩（最长边 1600 px，质量 78%）
              </option>
              <option value="thumbnail">仅保留缩略图（最多 360 px）</option>
            </select>
          </label>
          <p className="settings-hint">
            两种方式都会丢失细节。缩略图模式用现有缩略图替换大图，放大查看与之后导出的备份也只保留缩略图细节。压缩会跳过已不超过
            1600 px
            的照片，避免反复损失画质；结果不更小时也会跳过，实际释放空间以完成结果为准。
          </p>
          <button
            className="secondary"
            disabled={!validBackup}
            onClick={() => void preview()}
          >
            查看归档范围
          </button>
        </fieldset>
      </div>
      {progress && (
        <p role="status">
          已处理 {progress.processed} 张 · 缩小 {progress.changed} 张 · 释放{" "}
          {(progress.saved / 1024 / 1024).toFixed(2)} MB
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
      {plan && (
        <Modal
          title="确认历史照片归档"
          onClose={() => {
            if (!busy) setPlan(null);
          }}
        >
          <p className="settings-warning-text">
            将处理 {new Date(plan.cutoff).toLocaleDateString("zh-CN")} 之前的{" "}
            {plan.photos.length} 张照片。
            {plan.mode === "thumbnail"
              ? "仅保留最多 360 px 的缩略图，放大细节会永久丢失。"
              : "大图将重新编码为最长边 1600 px、质量 78% 的 JPEG，会丢失细节。"}
            记录、备注与时段保留。
          </p>
          <p className="settings-note">
            逐张保存；停止、离开设置或合上手记后不再处理后续照片。已完成部分保留，恢复原大图需要用归档前的备份覆盖整本手记。
          </p>
          <label className="storage-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已把当前完整备份存到文件中，理解归档无法撤销
          </label>
          {busy && progress && (
            <p role="status">
              已处理 {progress.processed} / {plan.photos.length} 张 · 缩小{" "}
              {progress.changed} 张
            </p>
          )}
          {busy ? (
            <button
              className="secondary wide"
              onClick={() => controller.current?.abort()}
            >
              停止归档
            </button>
          ) : (
            <button
              className="danger-button wide"
              disabled={!confirmed || !validBackup || !plan.photos.length}
              onClick={() => void execute()}
            >
              确认归档 {plan.photos.length} 张
            </button>
          )}
        </Modal>
      )}
    </section>
  );
}
