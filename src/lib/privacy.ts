// Native camera, photo/file picker and the share sheet can temporarily hide Safari.
// Keep the pending action alive for at most 15 minutes; ordinary backgrounding locks after 1 minute.
let systemDialogUntil = 0;
export const beginSystemDialog = () => {
  systemDialogUntil = Date.now() + 15 * 60 * 1000;
};
export const endSystemDialog = () => {
  systemDialogUntil = 0;
};
export const inSystemDialog = () => Date.now() < systemDialogUntil;
