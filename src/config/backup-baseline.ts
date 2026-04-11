import path from "node:path";

export interface BackupBaselineFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  copyFile: (from: string, to: string) => Promise<void>;
  chmod?: (path: string, mode: number) => Promise<void>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
}

export async function syncConfigBackupBaseline(
  configPath: string,
  ioFs: BackupBaselineFs,
  currentRaw: string,
): Promise<boolean> {
  const backupPath = `${configPath}.bak`;

  let backupRaw: string | null = null;
  try {
    backupRaw = await ioFs.readFile(backupPath, "utf-8");
  } catch {
    backupRaw = null;
  }

  if (backupRaw === currentRaw) {
    return false;
  }

  if (ioFs.mkdir) {
    await ioFs.mkdir(path.dirname(backupPath), { recursive: true }).catch(() => {
      // best-effort
    });
  }

  await ioFs.copyFile(configPath, backupPath);
  await ioFs.chmod?.(backupPath, 0o600).catch(() => {
    // best-effort
  });
  return true;
}
