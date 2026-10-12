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
}
export interface WearSession {
  id: string;
  start: number;
  end: number | null;
  note: string;
}
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
export interface PhotoInput {
  id: string;
  full: Blob;
  thumb: Blob;
}
export const id = () => crypto.randomUUID();
