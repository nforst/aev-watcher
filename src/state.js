import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_REMEMBERED_IDS = 1000;

const EMPTY_STATE = {
  version: 1,
  seenIds: [],
  firstRunAt: null,
  lastRunAt: null,
  lastNotifiedAt: null,
};

/**
 * Laedt den Zustand. `isFirstRun` ist true, wenn noch keine State-Datei existiert.
 */
export async function loadState(file) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      state: {
        ...EMPTY_STATE,
        ...parsed,
        seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds.map(Number).filter(Number.isFinite) : [],
      },
      isFirstRun: false,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { state: { ...EMPTY_STATE, seenIds: [] }, isFirstRun: true };
    }
    throw new Error(`State-Datei ${file} ist nicht lesbar: ${error.message}`);
  }
}

/** Schreibt atomar (erst temporaere Datei, dann rename), damit ein Abbruch den State nicht zerstoert. */
export async function saveState(file, state) {
  const trimmed = {
    ...state,
    seenIds: [...new Set(state.seenIds)].sort((a, b) => a - b).slice(-MAX_REMEMBERED_IDS),
  };

  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
  return trimmed;
}
