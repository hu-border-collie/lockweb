import type { Vault } from "./db";
import { compressArchiveImage } from "./images";

export type ArchiveMode = "compressed" | "thumbnail";
export interface ArchivePlan {
  vaultId: string;
  revision: number;
  cutoff: number;
  mode: ArchiveMode;
  photos: { id: string; ownerId: string }[];
}
export interface ArchiveProgress {
  processed: number;
  changed: number;
  saved: number;
}
// Clamp month ends rather than letting setMonth roll into the following month.
export function archiveCutoff(months: 6 | 12, now = new Date()) {
  const date = new Date(now);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
export async function planArchive(
  vault: Vault,
  cutoff: number,
  mode: ArchiveMode,
): Promise<ArchivePlan> {
  if (
    !Number.isFinite(cutoff) ||
    cutoff < 0 ||
    cutoff > Date.now() ||
    !["compressed", "thumbnail"].includes(mode)
  )
    throw new Error("归档范围无效");
  const snap = await vault.snapshot();
  return {
    vaultId: vault.config.id,
    revision: snap.revision,
    cutoff,
    mode,
    photos: snap.entries
      .filter((e) => e.timestamp < cutoff)
      .flatMap((e) => e.photoIds.map((id) => ({ id, ownerId: e.id }))),
  };
}
export async function archivePhotos(
  vault: Vault,
  plan: ArchivePlan,
  backup: { vaultId: string; revision: number },
  signal: AbortSignal,
  onProgress: (progress: ArchiveProgress) => void,
  compress = compressArchiveImage,
) {
  if (
    backup.vaultId !== vault.config.id ||
    plan.vaultId !== vault.config.id ||
    backup.revision !== plan.revision
  )
    throw new Error("请先导出并保存当前数据的完整加密备份");
  let revision = plan.revision;
  const progress: ArchiveProgress = { processed: 0, changed: 0, saved: 0 };
  await vault.assertRevision(revision);
  for (const photo of plan.photos) {
    signal.throwIfAborted();
    await vault.assertRevision(revision);
    const original = await vault.photo(photo.id);
    const result =
      plan.mode === "thumbnail"
        ? await vault.photo(photo.id, true)
        : await compress(original);
    signal.throwIfAborted();
    if (result.size < original.size) {
      progress.saved += await vault.archivePhoto(
        photo.id,
        photo.ownerId,
        result,
        revision,
        signal,
      );
      revision++;
      progress.changed++;
    }
    progress.processed++;
    onProgress({ ...progress });
  }
  await vault.assertRevision(revision);
  return progress;
}
