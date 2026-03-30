
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'chunks');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create chunk data directory:', err);
  }
}

function getFilePath(id: string): string {
  // Use the raw ID directly – no hyphens, no formatting
  return path.join(DATA_DIR, `${id}.txt`);
}

export async function saveChunkText(id: string, text: string): Promise<void> {
  await ensureDataDir();
  const filePath = getFilePath(id);
  await fs.writeFile(filePath, text, 'utf-8');
  console.log(`💾 Saved text for chunk ${id} (${text.length} chars)`);
}

export async function getChunkText(id: string): Promise<string> {
  const filePath = getFilePath(id);
  const content = await fs.readFile(filePath, 'utf-8');
  return content;
}

export async function deleteChunkText(id: string): Promise<void> {
  try {
    await fs.unlink(getFilePath(id));
  } catch (error) {
    // ignore if file doesn't exist
  }
}

export async function deleteChunkTexts(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => deleteChunkText(id)));
}