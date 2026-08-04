import { YouTubeSubtitleList } from "./YouTubeSubtitleList";
import { apiMicrosoftDict } from "../apis/index.js";
import { getSettingWithDefault } from "../libs/storage.js";

jest.mock("../libs/storage.js", () => ({
  getSettingWithDefault: jest.fn(() => Promise.resolve({ darkMode: "light" })),
}));

const mockDownloadBlobFile = jest.fn();

jest.mock("../libs/utils.js", () => ({
  downloadBlobFile: (...args) => mockDownloadBlobFile(...args),
}));

const mockSaveFavoriteWord = jest.fn();
const mockRemoveFavoriteOccurrence = jest.fn();
const mockGetFavoriteWords = jest.fn();
const mockGetVideoFavoriteEntries = jest.fn();
const mockHasFavoriteOccurrence = jest.fn();
const mockSubscribeFavoriteWords = jest.fn();

jest.mock("../libs/favWords.js", () => ({
  getFavoriteWords: (...args) => mockGetFavoriteWords(...args),
  getVideoFavoriteEntries: (...args) => mockGetVideoFavoriteEntries(...args),
  hasFavoriteOccurrence: (...args) => mockHasFavoriteOccurrence(...args),
  removeFavoriteOccurrence: (...args) => mockRemoveFavoriteOccurrence(...args),
  saveFavoriteWord: (...args) => mockSaveFavoriteWord(...args),
  subscribeFavoriteWords: (...args) => mockSubscribeFavoriteWords(...args),
}));

jest.mock("../apis/index.js", () => ({
  apiMicrosoftDict: jest.fn(),
}));

function createVideoElement({ playerHeight = 360 } = {}) {
  document.body.innerHTML = '<div id="secondary-inner"></div>';
  let currentPlayerHeight = playerHeight;
  const player = document.createElement("div");
  player.className = "html5-video-player";
  player.getBoundingClientRect = () => ({ height: currentPlayerHeight });
  const video = document.createElement("video");

  Object.defineProperty(video, "paused", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(video, "currentTime", {
    value: 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(video, "play", {
    value: jest.fn(() => Promise.resolve()),
    configurable: true,
  });
  Object.defineProperty(video, "__setPlayerHeight", {
    value: (height) => {
      currentPlayerHeight = height;
    },
  });

  player.appendChild(video);
  document.body.appendChild(player);
  return video;
}

const subtitle = {
  start: 0,
  end: 1000,
  text: "hello world",
  translation: "你好世界",
};

function renderVisibleSubtitleItems(manager) {
  manager.subtitleListEl.getClientRects = () => [{ width: 320, height: 300 }];
  Object.defineProperty(manager.subtitleScrollContainer, "clientHeight", {
    value: 300,
    configurable: true,
  });
  manager._renderVirtualSubtitles(true);
}

describe("YouTubeSubtitleList", () => {
  beforeEach(() => {
    apiMicrosoftDict.mockReset();
    mockDownloadBlobFile.mockReset();
    getSettingWithDefault.mockReset();
    getSettingWithDefault.mockResolvedValue({ darkMode: "light" });
    mockGetFavoriteWords.mockReset();
    mockGetFavoriteWords.mockResolvedValue({});
    mockGetVideoFavoriteEntries.mockReset();
    mockGetVideoFavoriteEntries.mockReturnValue([]);
    mockHasFavoriteOccurrence.mockReset();
    mockHasFavoriteOccurrence.mockReturnValue(false);
    mockSubscribeFavoriteWords.mockReset();
    mockSubscribeFavoriteWords.mockReturnValue(jest.fn());
    mockSaveFavoriteWord.mockReset();
    mockSaveFavoriteWord.mockResolvedValue({ videoCount: 1 });
    mockRemoveFavoriteOccurrence.mockReset();
    mockRemoveFavoriteOccurrence.mockResolvedValue({ videoCount: 0 });
    window.history.replaceState({}, "", "/watch?v=test-video");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("renders panel controls with i18n text", async () => {
    const videoEl = createVideoElement();
    const i18n = jest.fn(
      (key) =>
        ({
          bilingual_subtitles: "Bilingual subtitles",
          vocabulary_book: "Vocabulary",
          download_subtitles_vtt: "Download subtitles (VTT)",
          download_raw_subtitle_events_json: "Download source data (JSON)",
          close: "Close panel",
        })[key] || ""
    );
    const manager = new YouTubeSubtitleList(videoEl, i18n);

    manager.initialize([subtitle], [], 75);

    const buttons = Array.from(document.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        "Bilingual subtitles [75%]",
        "Vocabulary",
        "Download subtitles (VTT)",
        "Download source data (JSON)",
      ])
    );
    expect(buttons.find((button) => button.textContent === "×").title).toBe(
      "Close panel"
    );

    await Promise.resolve();
    await Promise.resolve();
    manager.destroy();
  });

  test("applies complete fallback theme before settings finish loading", () => {
    getSettingWithDefault.mockReturnValue(new Promise(() => {}));
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl);

    manager.initialize([subtitle], [], 15);

    expect(manager.container.style.getPropertyValue("--kt-primary")).toBe(
      "#EC407A"
    );
    expect(manager.container.style.getPropertyValue("--kt-btn-bg")).toBe(
      "var(--kt-primary)"
    );
    expect(manager.container.style.getPropertyValue("--kt-text")).toBe(
      "#37474F"
    );

    manager.destroy();
  });

  test("replaces an orphaned sidebar instead of reusing stale controls", () => {
    const videoEl = createVideoElement();
    const staleContainer = document.createElement("div");
    staleContainer.id = "kiss-youtube-subtitle-list-container";
    staleContainer.appendChild(document.createElement("button"));
    document.getElementById("secondary-inner").appendChild(staleContainer);
    const manager = new YouTubeSubtitleList(videoEl);

    expect(() => manager.initialize([subtitle], [], 15)).not.toThrow();

    expect(manager.container).not.toBe(staleContainer);
    expect(staleContainer.isConnected).toBe(false);
    expect(manager.subtitleListEl).not.toBeNull();
    expect(manager.container.textContent).toContain("[15%]");
    Array.from(manager.container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("VTT"))
      .click();
    expect(mockDownloadBlobFile).toHaveBeenCalledWith(
      expect.stringContaining("WEBVTT"),
      expect.stringMatching(/\.vtt$/)
    );

    manager.destroy();
  });

  test("matches the subtitle panel height to the YouTube player", async () => {
    const videoEl = createVideoElement({ playerHeight: 420 });
    const manager = new YouTubeSubtitleList(videoEl);

    manager.initialize([subtitle], [], 100);

    const container = document.getElementById(
      "kiss-youtube-subtitle-list-container"
    );
    expect(container.style.height).toBe("420px");
    expect(container.style.maxHeight).toBe("420px");

    videoEl.__setPlayerHeight(360);
    window.dispatchEvent(new Event("resize"));

    expect(container.style.height).toBe("360px");
    expect(container.style.maxHeight).toBe("360px");

    await Promise.resolve();
    await Promise.resolve();
    manager.destroy();
  });

  test("adds hover lookup spans to original text when enabled", async () => {
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl, () => "", {
      enableHoverLookup: true,
    });

    manager.initialize([subtitle], [], 100);
    renderVisibleSubtitleItems(manager);

    expect(
      Array.from(
        document.querySelectorAll(".kiss-youtube-original .kiss-subtitle-word")
      ).map((node) => node.textContent)
    ).toEqual(["hello", "world"]);

    await Promise.resolve();
    await Promise.resolve();
    manager.destroy();
  });

  test("looks up hovered words but saves only after an explicit click", async () => {
    jest.useFakeTimers();
    apiMicrosoftDict.mockResolvedValue({
      aus: [{ key: "美", phonetic: "/redi/" }],
      trs: [{ pos: "adj.", def: "准备好的" }],
      sentences: [{ eng: "ready to go", chs: "准备出发" }],
    });
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl, () => "", {
      enableHoverLookup: true,
    });
    manager.initialize(
      [{ ...subtitle, start: 33000, text: "ready to go" }],
      [],
      100
    );
    renderVisibleSubtitleItems(manager);
    document
      .querySelector(".kiss-subtitle-word")
      .dispatchEvent(new Event("pointerenter"));
    jest.advanceTimersByTime(300);
    await apiMicrosoftDict.mock.results[0].value;
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMicrosoftDict).toHaveBeenCalledWith("ready");
    expect(mockSaveFavoriteWord).not.toHaveBeenCalled();

    const tooltip = document.querySelector(".kiss-word-tooltip");
    tooltip.getBoundingClientRect = () => ({
      left: 600,
      right: 900,
      top: 60,
      bottom: 260,
      width: 300,
      height: 200,
    });
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    const toastRectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        if (this.classList?.contains("kiss-word-toast")) {
          return { width: 220, height: 44 };
        }
        return originalGetBoundingClientRect.call(this);
      });
    jest.useRealTimers();
    document.querySelector(".kiss-word-favorite-button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSaveFavoriteWord).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "ready",
        definition: "adj. 准备好的",
        occurrence: expect.objectContaining({
          videoId: "test-video",
          timestamp: 33000,
          originalText: "ready to go",
          translation: "你好世界",
        }),
      })
    );
    const toast = document.querySelector(".kiss-word-toast");
    expect(toast.style.left).toBe("680px");
    expect(toast.style.top).toBe("268px");
    expect(toast.querySelector("button")).not.toBeNull();
    toastRectSpy.mockRestore();

    manager.destroy();
    jest.useRealTimers();
  });

  test("collects a subtitle word directly when the word is clicked", async () => {
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl, () => "", {
      enableHoverLookup: true,
    });
    manager.initialize(
      [{ ...subtitle, start: 33000, text: "ready to go" }],
      [],
      100
    );
    renderVisibleSubtitleItems(manager);

    const word = document.querySelector(".kiss-subtitle-word");
    word.getBoundingClientRect = () => ({
      left: 400,
      right: 460,
      top: 500,
      bottom: 520,
      width: 60,
      height: 20,
    });
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    const toastRectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function () {
        if (this.classList?.contains("kiss-word-toast")) {
          return { width: 180, height: 44 };
        }
        return originalGetBoundingClientRect.call(this);
      });
    word.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMicrosoftDict).not.toHaveBeenCalled();
    expect(mockSaveFavoriteWord).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "ready",
        occurrence: expect.objectContaining({
          videoId: "test-video",
          timestamp: 33000,
          originalText: "ready to go",
          translation: "你好世界",
        }),
      })
    );
    const toast = document.querySelector(".kiss-word-toast");
    expect(toast.style.left).toBe("340px");
    expect(toast.style.top).toBe("448px");
    toastRectSpy.mockRestore();

    manager.destroy();
  });

  test("keeps the original player-relative position and inherits panel styling", async () => {
    jest.useFakeTimers();
    apiMicrosoftDict.mockResolvedValue({
      trs: [{ pos: "adj.", def: "prepared" }],
    });
    const videoEl = createVideoElement();
    const player = videoEl.closest(".html5-video-player");
    player.getBoundingClientRect = () => ({
      height: 360,
      right: 980,
      top: 40,
    });
    const manager = new YouTubeSubtitleList(videoEl, () => "", {
      enableHoverLookup: true,
    });

    manager.initialize([{ ...subtitle, text: "ready to go" }], [], 100);
    manager.container.style.setProperty("--kt-primary", "#123456");
    manager.container.style.setProperty("--kt-bg", "rgb(250, 240, 245)");
    renderVisibleSubtitleItems(manager);
    const word = document.querySelector(".kiss-subtitle-word");
    word.style.fontFamily = "Georgia";

    word.dispatchEvent(new Event("pointerenter"));
    jest.advanceTimersByTime(300);
    await apiMicrosoftDict.mock.results[0].value;
    await Promise.resolve();

    const tooltip = document.querySelector(".kiss-word-tooltip");
    expect(tooltip.style.left).toBe("635px");
    expect(tooltip.style.top).toBe("60px");
    expect(tooltip.style.fontFamily).toBe("Georgia");
    expect(tooltip.style.getPropertyValue("--kt-primary")).toBe("#123456");
    expect(tooltip.style.getPropertyValue("--kt-bg")).toBe(
      "rgb(250, 240, 245)"
    );

    manager.destroy();
  });

  test("clears word tooltip when the subtitle list scrolls away from the hovered word", async () => {
    jest.useFakeTimers();
    apiMicrosoftDict.mockResolvedValue({
      trs: [{ pos: "adj.", def: "准备好的" }],
    });
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl, () => "", {
      enableHoverLookup: true,
    });

    manager.initialize([{ ...subtitle, text: "ready to go" }], [], 100);
    renderVisibleSubtitleItems(manager);
    const word = document.querySelector(".kiss-subtitle-word");

    word.dispatchEvent(new Event("pointerenter"));
    jest.advanceTimersByTime(300);
    await apiMicrosoftDict.mock.results[0].value;
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector(".kiss-word-tooltip")).not.toBeNull();
    expect(word.classList.contains("kiss-word-hover")).toBe(true);

    manager.subtitleScrollContainer.dispatchEvent(new Event("scroll"));

    expect(document.querySelector(".kiss-word-tooltip")).toBeNull();
    expect(word.classList.contains("kiss-word-hover")).toBe(false);

    manager.destroy();
  });

  test("renders persistent words for the current video and removes only that occurrence", async () => {
    mockGetVideoFavoriteEntries.mockReturnValue([
      [
        "ready",
        {
          word: "ready",
          definition: "adj. 准备好的",
          occurrences: [],
          occurrence: {
            sourceType: "youtube",
            videoId: "test-video",
            videoTitle: "Test lesson",
            timestamp: 33000,
            originalText: "Ready to go.",
            translation: "准备出发。",
            addedAt: 100,
          },
        },
      ],
    ]);
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl, (key) => {
      if (key === "vocabulary_book") return "Vocabulary";
      return "";
    });

    manager.initialize([subtitle], [], 100);
    await Promise.resolve();
    await Promise.resolve();
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Vocabulary (1)")
      .click();

    expect(document.body.textContent).toContain("Ready to go.");
    expect(document.body.textContent).toContain("准备出发。");
    document.querySelector('[title="从本视频生词本移除"]').click();
    await Promise.resolve();

    expect(mockRemoveFavoriteOccurrence).toHaveBeenCalledWith(
      "ready",
      "test-video"
    );
    manager.destroy();
  });

  test("jumps only when clicking the time label", async () => {
    const videoEl = createVideoElement();
    const manager = new YouTubeSubtitleList(videoEl);

    manager.initialize([{ ...subtitle, start: 33000 }], [], 100);
    renderVisibleSubtitleItems(manager);

    document.querySelector(".kiss-youtube-original").click();
    expect(videoEl.currentTime).toBe(0);

    document.querySelector(".kiss-youtube-item span").click();
    expect(videoEl.currentTime).toBe(33);

    await Promise.resolve();
    await Promise.resolve();
    manager.destroy();
  });
});
