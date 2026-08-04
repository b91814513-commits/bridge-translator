import {
  collectSubtitleData,
  formatSubtitlesForPrompt,
} from "./videoSummary.js";

describe("videoSummary subtitle input", () => {
  afterEach(() => {
    delete window.__kissYouTubeSubtitleList;
  });

  test("uses the complete original YouTube subtitle events instead of translated subtitles", () => {
    window.__kissYouTubeSubtitleList = {
      rawSubtitleEvents: [
        {
          tStartMs: 1000,
          dDurationMs: 2000,
          segs: [{ utf8: "Original " }, { utf8: "first line" }],
        },
        {
          tStartMs: 4000,
          dDurationMs: 1500,
          segs: [{ utf8: "Original second line" }],
        },
      ],
      bilingualSubtitles: [
        {
          start: 1000,
          end: 3000,
          text: "Processed partial line",
          translation: "Translated partial line",
        },
      ],
    };

    expect(collectSubtitleData()).toEqual([
      {
        start: 1000,
        end: 3000,
        text: "Original first line",
      },
      {
        start: 4000,
        end: 5500,
        text: "Original second line",
      },
    ]);
  });

  test("formats only original text even when fallback subtitles contain translations", () => {
    expect(
      formatSubtitlesForPrompt([
        {
          start: 1000,
          end: 3000,
          text: "Original line",
          translation: "Translated line",
        },
      ])
    ).toBe("[00:01] Original line");
  });

  test("formats the complete subtitle track beyond the former length limit", () => {
    const subtitles = Array.from({ length: 100 }, (_, index) => ({
      start: index * 1000,
      end: (index + 1) * 1000,
      text: `${index}-${"x".repeat(140)}`,
    }));

    const formatted = formatSubtitlesForPrompt(subtitles);

    expect(formatted.length).toBeGreaterThan(12000);
    expect(formatted).toContain(`[01:39] 99-${"x".repeat(140)}`);
  });
});
