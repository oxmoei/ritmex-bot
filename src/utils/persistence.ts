import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
let dataDirReady = false;

async function ensureDataDir(): Promise<void> {
  if (dataDirReady) return;
  await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => undefined);
  dataDirReady = true;
}

export async function loadState<T>(fileName: string): Promise<T | null> {
  try {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, fileName);
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    console.error(`[state] load ${fileName} failed`, error);
    return null;
  }
}

export async function saveState(fileName: string, state: unknown): Promise<void> {
  try {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, fileName);
    const tempPath = `${filePath}.tmp`;
    const payload = JSON.stringify(state, null, 2);
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    console.error(`[state] save ${fileName} failed`, error);
  }
}
