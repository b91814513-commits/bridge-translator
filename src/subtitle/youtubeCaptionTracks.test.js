import {
  buildTrackKey,
  findCaptionTrack,
  getSubtitleEvents,
  isChatCaptionTrack,
  isSameLang,
} from "./youtubeCaptionTracks.js";

jest.mock("../libs/log.js", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
  },
}));

describe("youtubeCaptionTracks", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("matches language families by their leading language code", () => {
    expect(isSameLang("zh-CN", "zh-TW")).toBe(true);
    expect(isSameLang("en", "fr")).toBe(false);
  });

  test("builds a stable track key from timedtext query parameters", () => {
    const url = new URL(
      "https://example.test/api?v=video-1&lang=en&kind=asr&name=English&tlang=zh"
    );

    expect(buildTrackKey(url)).toBe("video-1|en|asr|English|zh");
  });

  test("detects live chat caption tracks", () => {
    expect(
      isChatCaptionTrack({ name: { simpleText: "Live Chat replay" } })
    ).toBe(true);
    expect(isChatCaptionTrack({ name: { simpleText: "English" } })).toBe(false);
  });

  test("prefers exact language and kind matches", () => {
    const exact = { languageCode: "en", kind: "asr" };
    const manual = { languageCode: "en" };

    expect(findCaptionTrack([manual, exact], "en", "asr")).toBe(exact);
  });

  test("falls back from ASR to a same-language manual track", () => {
    const asr = { languageCode: "en", kind: "asr" };
    const manual = { languageCode: "en-US" };

    expect(findCaptionTrack([asr, manual], "fr", null)).toBe(manual);
  });

  test("falls back away from chat tracks when possible", () => {
    const chat = { languageCode: "en", name: { simpleText: "Live chat" } };
    const normal = { languageCode: "en", name: { simpleText: "English" } };

    expect(findCaptionTrack([chat, normal], "en", null)).toBe(normal);
  });

  test("keeps the existing pop fallback behavior when no track matches", () => {
    const tracks = [{ languageCode: "de" }];

    expect(findCaptionTrack(tracks, "en", null)).toEqual({
      languageCode: "de",
    });
    expect(tracks).toHaveLength(0);
  });

  test("uses the intercepted response directly for an author-provided track", async () => {
    global.fetch = jest.fn();
    const events = [{ tStartMs: 0, dDurationMs: 1000 }];
    const capUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en"
    );
    const interceptedUrl = new URL(capUrl.href);

    await expect(
      getSubtitleEvents(capUrl, interceptedUrl, JSON.stringify({ events }))
    ).resolves.toEqual(events);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("fetches a complete source track for ASR captions", async () => {
    const fullEvents = [
      { tStartMs: 0, dDurationMs: 1000 },
      { tStartMs: 60000, dDurationMs: 1000 },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ events: fullEvents }),
    });
    const capUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&signature=track-signature"
    );
    const interceptedUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=player-token&sq=3&range=1000-2000&rn=2&rbuf=1"
    );

    const events = await getSubtitleEvents(
      capUrl,
      interceptedUrl,
      JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000 }] })
    );

    expect(events).toEqual(fullEvents);
    const requestedUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("signature")).toBe("track-signature");
    expect(requestedUrl.searchParams.get("pot")).toBe("player-token");
    expect(requestedUrl.searchParams.get("fmt")).toBe("json3");
    expect(requestedUrl.searchParams.get("kind")).toBe("asr");
    expect(requestedUrl.searchParams.has("sq")).toBe(false);
    expect(requestedUrl.searchParams.has("range")).toBe(false);
    expect(requestedUrl.searchParams.has("rn")).toBe(false);
    expect(requestedUrl.searchParams.has("rbuf")).toBe(false);
  });

  test("removes auto-translation parameters when fetching the full source track", async () => {
    const fullEvents = [{ tStartMs: 0, dDurationMs: 1000 }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ events: fullEvents }),
    });
    const capUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=ja&signature=track-signature"
    );
    const interceptedUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=ja&tlang=zh-CN&pot=player-token&sq=4"
    );

    await expect(
      getSubtitleEvents(
        capUrl,
        interceptedUrl,
        JSON.stringify({ events: [{ tStartMs: 30000 }] })
      )
    ).resolves.toEqual(fullEvents);

    const requestedUrl = new URL(global.fetch.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("lang")).toBe("ja");
    expect(requestedUrl.searchParams.has("tlang")).toBe(false);
    expect(requestedUrl.searchParams.has("sq")).toBe(false);
  });

  test("falls back to intercepted events when the complete-track request fails", async () => {
    const partialEvents = [{ tStartMs: 30000, dDurationMs: 1000 }];
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const capUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr"
    );
    const interceptedUrl = new URL(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=player-token&sq=2"
    );

    await expect(
      getSubtitleEvents(
        capUrl,
        interceptedUrl,
        JSON.stringify({ events: partialEvents })
      )
    ).resolves.toEqual(partialEvents);
  });
});
