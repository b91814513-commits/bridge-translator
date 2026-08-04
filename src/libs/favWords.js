import { KV_WORDS_KEY, STOKEY_WORDS } from "../config";
import { browser } from "./browser";
import { debounceSyncMeta, getWordsWithDefault, setWords } from "./storage";

const listeners = new Set();
let mutationQueue = Promise.resolve();
let storageListenerAttached = false;

export function normalizeWordKey(word) {
  return String(word || "")
    .trim()
    .toLowerCase();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === null || item === undefined || item === "") return false;
      return !Array.isArray(item) || item.length > 0;
    })
  );
}

function normalizeOccurrence(occurrence) {
  if (!occurrence || occurrence.sourceType !== "youtube") return null;

  const videoId = String(occurrence.videoId || "").trim();
  if (!videoId) return null;

  return compactObject({
    sourceType: "youtube",
    videoId,
    videoTitle: String(occurrence.videoTitle || "YouTube Video").trim(),
    sourceUrl:
      occurrence.sourceUrl ||
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    timestamp: Number.isFinite(occurrence.timestamp) ? occurrence.timestamp : 0,
    originalText: String(occurrence.originalText || "").trim(),
    translation: String(occurrence.translation || "").trim(),
    addedAt: Number.isFinite(occurrence.addedAt)
      ? occurrence.addedAt
      : Date.now(),
  });
}

function occurrenceKey(occurrence) {
  return `${occurrence.sourceType}:${occurrence.videoId}`;
}

function mergeOccurrences(left = [], right = []) {
  const merged = new Map();
  [...left, ...right].forEach((rawOccurrence) => {
    const occurrence = normalizeOccurrence(rawOccurrence);
    if (!occurrence) return;
    const key = occurrenceKey(occurrence);
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, ...occurrence } : occurrence);
  });
  return Array.from(merged.values());
}

function normalizeEntry(rawKey, rawValue) {
  const value = rawValue && typeof rawValue === "object" ? rawValue : {};
  const word = String(value.word || rawKey || "").trim();
  if (!word) return null;

  const occurrences = mergeOccurrences([], value.occurrences);
  const createdAt = Number.isFinite(value.createdAt)
    ? value.createdAt
    : Date.now();
  const updatedAt = Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : createdAt;

  return {
    ...compactObject({
      word,
      createdAt,
      updatedAt,
      phonetic: String(value.phonetic || "").trim(),
      definition: String(value.definition || "").trim(),
      examples: Array.isArray(value.examples) ? value.examples : [],
      // Legacy/imported/selection favorites have no source occurrence.
      ungrouped: value.ungrouped === true || occurrences.length === 0,
    }),
    occurrences,
  };
}

function mergeEntries(left, right) {
  const occurrences = mergeOccurrences(left.occurrences, right.occurrences);
  return {
    ...compactObject({
      word: left.word || right.word,
      createdAt: Math.min(left.createdAt, right.createdAt),
      updatedAt: Math.max(left.updatedAt, right.updatedAt),
      phonetic: right.phonetic || left.phonetic || "",
      definition: right.definition || left.definition || "",
      examples:
        right.examples?.length > 0 ? right.examples : left.examples || [],
      ungrouped: left.ungrouped === true || right.ungrouped === true,
    }),
    occurrences,
  };
}

export function normalizeFavoriteWords(rawWords) {
  const normalized = {};
  Object.entries(rawWords || {}).forEach(([rawKey, rawValue]) => {
    const entry = normalizeEntry(rawKey, rawValue);
    if (!entry) return;
    const key = normalizeWordKey(entry.word);
    normalized[key] = normalized[key]
      ? mergeEntries(normalized[key], entry)
      : entry;
  });
  return normalized;
}

function emit(words) {
  listeners.forEach((listener) => listener(words));
}

function parseStoredWords(value) {
  if (typeof value !== "string") return normalizeFavoriteWords(value);
  try {
    return normalizeFavoriteWords(JSON.parse(value));
  } catch (error) {
    return {};
  }
}

function attachStorageListener() {
  if (storageListenerAttached) return;
  storageListenerAttached = true;

  browser?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[STOKEY_WORDS]) return;
    emit(parseStoredWords(changes[STOKEY_WORDS].newValue));
  });

  if (typeof window !== "undefined" && !browser?.storage?.onChanged) {
    window.addEventListener("storage", (event) => {
      if (event.key === STOKEY_WORDS) emit(parseStoredWords(event.newValue));
    });
  }
}

export function subscribeFavoriteWords(listener) {
  attachStorageListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getFavoriteWords() {
  return normalizeFavoriteWords(await getWordsWithDefault());
}

async function runMutation(mutator) {
  const execute = async () => {
    const current = await getFavoriteWords();
    const result = await mutator(current);
    const nextWords = normalizeFavoriteWords(result.words || result);
    await setWords(nextWords);
    debounceSyncMeta(KV_WORDS_KEY);
    emit(nextWords);
    return { ...result, words: nextWords };
  };

  mutationQueue = mutationQueue.then(execute, execute);
  return mutationQueue;
}

export function hasFavoriteOccurrence(words, word, videoId) {
  const entry = normalizeFavoriteWords(words)[normalizeWordKey(word)];
  if (!entry || !videoId) return false;
  return entry.occurrences?.some(
    (occurrence) =>
      occurrence.sourceType === "youtube" && occurrence.videoId === videoId
  );
}

export function getVideoFavoriteEntries(words, videoId) {
  if (!videoId) return [];
  return Object.entries(normalizeFavoriteWords(words))
    .map(([key, entry]) => {
      const occurrence = entry.occurrences?.find(
        (item) => item.sourceType === "youtube" && item.videoId === videoId
      );
      return occurrence ? [key, { ...entry, occurrence }] : null;
    })
    .filter(Boolean)
    .sort(
      (left, right) => right[1].occurrence.addedAt - left[1].occurrence.addedAt
    );
}

export async function saveFavoriteWord({
  word,
  phonetic = "",
  definition = "",
  examples = [],
  occurrence = null,
  ungrouped = false,
}) {
  const key = normalizeWordKey(word);
  if (!key) return { words: await getFavoriteWords(), added: false };

  return runMutation((words) => {
    const now = Date.now();
    const previous = words[key];
    const nextOccurrence = normalizeOccurrence(
      occurrence ? { ...occurrence, addedAt: occurrence.addedAt || now } : null
    );
    const occurrenceIndex = nextOccurrence
      ? (previous?.occurrences?.findIndex(
          (item) => occurrenceKey(item) === occurrenceKey(nextOccurrence)
        ) ?? -1)
      : -1;
    const occurrences = previous?.occurrences ? [...previous.occurrences] : [];

    if (nextOccurrence) {
      if (occurrenceIndex >= 0) {
        occurrences[occurrenceIndex] = {
          ...occurrences[occurrenceIndex],
          ...nextOccurrence,
          addedAt: occurrences[occurrenceIndex].addedAt,
        };
      } else {
        occurrences.push(nextOccurrence);
      }
    }

    const entry = {
      ...compactObject({
        word: previous?.word || String(word).trim(),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        phonetic: phonetic || previous?.phonetic || "",
        definition: definition || previous?.definition || "",
        examples: examples.length > 0 ? examples : previous?.examples || [],
        ungrouped: ungrouped || previous?.ungrouped === true,
      }),
      occurrences,
    };
    const nextWords = { ...words, [key]: entry };
    const videoId = nextOccurrence?.videoId;

    return {
      words: nextWords,
      entry,
      added: Boolean(nextOccurrence && occurrenceIndex < 0),
      videoCount: videoId
        ? getVideoFavoriteEntries(nextWords, videoId).length
        : 0,
    };
  });
}

export async function removeFavoriteOccurrence(word, videoId) {
  const key = normalizeWordKey(word);
  return runMutation((words) => {
    const previous = words[key];
    if (!previous) return { words, removed: false };

    const occurrences = (previous.occurrences || []).filter(
      (item) => !(item.sourceType === "youtube" && item.videoId === videoId)
    );
    const nextWords = { ...words };
    if (occurrences.length === 0 && previous.ungrouped !== true) {
      delete nextWords[key];
    } else {
      nextWords[key] = { ...previous, occurrences, updatedAt: Date.now() };
    }
    return {
      words: nextWords,
      removed: occurrences.length !== (previous.occurrences || []).length,
      videoCount: getVideoFavoriteEntries(nextWords, videoId).length,
    };
  });
}

export async function removeFavoriteWord(word) {
  const key = normalizeWordKey(word);
  return runMutation((words) => {
    if (!words[key]) return { words, removed: false };
    const nextWords = { ...words };
    delete nextWords[key];
    return { words: nextWords, removed: true };
  });
}

export async function toggleUngroupedFavorite(word, metadata = {}) {
  const key = normalizeWordKey(word);
  if (!key) return { words: await getFavoriteWords(), added: false };
  return runMutation((current) => {
    const previous = current[key];
    const nextWords = { ...current };
    if (previous?.ungrouped) {
      if (!previous.occurrences?.length) delete nextWords[key];
      else nextWords[key] = { ...previous, ungrouped: false };
      return { words: nextWords, removed: true };
    }

    const now = Date.now();
    nextWords[key] = {
      ...(previous || {}),
      word: previous?.word || String(word).trim(),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      phonetic: metadata.phonetic || previous?.phonetic || "",
      definition: metadata.definition || previous?.definition || "",
      examples:
        metadata.examples?.length > 0
          ? metadata.examples
          : previous?.examples || [],
      occurrences: previous?.occurrences || [],
      ungrouped: true,
    };
    return { words: nextWords, added: true };
  });
}

export async function mergeFavoriteWords(wordsToMerge) {
  return runMutation((words) => {
    const now = Date.now();
    const nextWords = { ...words };
    wordsToMerge.forEach((word) => {
      const key = normalizeWordKey(word);
      if (!key) return;
      const previous = nextWords[key];
      nextWords[key] = {
        word: previous?.word || String(word).trim(),
        createdAt: previous?.createdAt || now,
        updatedAt: previous?.updatedAt || now,
        ...(previous || {}),
        ungrouped: true,
      };
    });
    return { words: nextWords };
  });
}

export async function clearFavoriteWords() {
  return runMutation(() => ({ words: {} }));
}
