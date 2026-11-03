import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { type StorageProvider, assertSafeKey } from "./storage.js";

/** Development driver: one file per key under a base folder. */
export function createLocalStorage(baseDir: string): StorageProvider {
  const root = resolve(baseDir);

  /** Resolves the key to a path and makes sure it cannot leave the base folder. */
  function pathFor(key: string): string {
    assertSafeKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
    return path;
  }

  return {
    async put(key, body) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },

    async get(key) {
      try {
        const body = await readFile(pathFor(key));
        return { body, contentType: null, sizeBytes: body.length };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
