export interface Entry {
  id: string;
  timestamp: number;
  note: string;
  tags: string[];
  wearing: "on" | "off" | "unspecified";
  comfort: number | null;
  photoIds: string[];
  createdAt: number;
  updatedAt: number;
  gearId?: string;
  sessionId?: string;
}
export interface WearSession {
  id: string;
  start: number;
  end: number | null;
  note: string;
  gearId?: string;
  breaks?: WearBreak[];
}
export interface WearBreak {
  start: number;
  end: number | null;
  note?: string;
}
export interface Gear {
  id: string;
  name: string;
  material: string;
  size: string;
  acquired: string;
  started: string;
  note: string;
  archived: boolean;
}
export interface CheckinTemplate {
  id: string;
  name: string;
  text: string;
}
export interface JournalSettings {
  templates: CheckinTemplate[];
  fastTags: string[];
  gears: Gear[];
  breakThresholdMinutes: number;
}
export const defaultSettings = (): JournalSettings => ({
  templates: [],
  fastTags: ["日常", "清洁", "运动", "不适", "调整"],
  gears: [],
  breakThresholdMinutes: 30,
});
export interface Sealed {
  iv: Uint8Array;
  data: Uint8Array;
}
export interface Row {
  id: string;
  sealed: Sealed;
}
export interface PhotoRow {
  id: string;
  ownerId: string;
  full: Sealed;
  thumb: Sealed;
}
export interface VaultConfig {
  version: 1;
  id: string;
  salt: Uint8Array;
  iterations: number;
  wrapped: Sealed;
}
export const QUICK_UNLOCK_META = "quick-unlock";
// Zero means no expiry; existing finite bindings retain their original policy.
export type QuickUnlockWindowHours = 0 | 1 | 12 | 24 | 168 | 720;
export interface QuickUnlockBinding {
  version: 1;
  id: string;
  vaultId: string;
  configFingerprint: string;
  origin: string;
  rpId: string;
  credentialId: Uint8Array;
  publicKey: Uint8Array;
  prfInput: Uint8Array;
  hkdfSalt: Uint8Array;
  windowHours: QuickUnlockWindowHours;
  authorizedAt: number;
  expiresAt: number | null;
  wrapped: Sealed;
  authorization: Sealed;
}
export interface PhotoInput {
  id: string;
  full: Blob;
  thumb: Blob;
}
export const id = () => crypto.randomUUID();
