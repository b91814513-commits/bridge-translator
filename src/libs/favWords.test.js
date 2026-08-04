import {
  getFavoriteWords,
  getVideoFavoriteEntries,
  normalizeFavoriteWords,
  removeFavoriteOccurrence,
  saveFavoriteWord,
} from "./favWords";
import { debounceSyncMeta, getWordsWithDefault, setWords } from "./storage";

jest.mock("./storage", () => ({
  debounceSyncMeta: jest.fn(),
  getWordsWithDefault: jest.fn(),
  setWords: jest.fn(),
}));

describe("favorite word store", () => {
  let storedWords;

  beforeEach(() => {
    storedWords = {};
    getWordsWithDefault.mockImplementation(async () => storedWords);
    setWords.mockImplementation(async (words) => {
      storedWords = words;
    });
    debounceSyncMeta.mockClear();
  });

  test("normalizes legacy words into the ungrouped collection", () => {
    const words = normalizeFavoriteWords({
      Ready: { createdAt: 100, definition: "prepared" },
    });

    expect(words.ready).toEqual(
      expect.objectContaining({
        word: "Ready",
        createdAt: 100,
        definition: "prepared",
        ungrouped: true,
        occurrences: [],
      })
    );
  });

  test("deduplicates a word within one video and keeps another video", async () => {
    await saveFavoriteWord({
      word: "Ready",
      definition: "prepared",
      occurrence: {
        sourceType: "youtube",
        videoId: "video-a",
        timestamp: 12000,
        originalText: "Are you ready?",
      },
    });
    await saveFavoriteWord({
      word: "ready",
      phonetic: "/redi/",
      occurrence: {
        sourceType: "youtube",
        videoId: "video-a",
        timestamp: 33000,
        originalText: "Ready to go.",
      },
    });
    await saveFavoriteWord({
      word: "READY",
      occurrence: {
        sourceType: "youtube",
        videoId: "video-b",
        timestamp: 5000,
      },
    });

    const words = await getFavoriteWords();
    expect(words.ready.occurrences).toHaveLength(2);
    expect(words.ready.phonetic).toBe("/redi/");
    expect(getVideoFavoriteEntries(words, "video-a")).toHaveLength(1);
    expect(
      words.ready.occurrences.find((item) => item.videoId === "video-a")
    ).toEqual(
      expect.objectContaining({
        timestamp: 33000,
        originalText: "Ready to go.",
      })
    );
  });

  test("removing one video occurrence preserves the other video", async () => {
    storedWords = normalizeFavoriteWords({
      ready: {
        word: "ready",
        createdAt: 100,
        updatedAt: 200,
        occurrences: [
          { sourceType: "youtube", videoId: "video-a", addedAt: 100 },
          { sourceType: "youtube", videoId: "video-b", addedAt: 200 },
        ],
      },
    });

    await removeFavoriteOccurrence("ready", "video-a");

    expect(storedWords.ready.occurrences).toEqual([
      expect.objectContaining({ videoId: "video-b" }),
    ]);
    expect(debounceSyncMeta).toHaveBeenCalled();
  });
});
