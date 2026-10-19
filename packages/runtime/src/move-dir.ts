import fs from 'node:fs/promises';

export async function moveDir(src: string, dest: string) {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true }); // Node 16.7+
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
