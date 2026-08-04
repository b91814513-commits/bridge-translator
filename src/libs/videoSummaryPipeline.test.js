import {
  generateCompleteVideoSummary,
  splitVideoSummaryText,
  VIDEO_SUMMARY_INTERMEDIATE_MAX_TOKENS,
} from "./videoSummaryPipeline.js";

describe("videoSummaryPipeline", () => {
  test("splits on subtitle line boundaries without loss or duplication", () => {
    const subtitles = [
      "[00:00] first caption",
      "[00:05] second caption",
      "[00:10] third caption",
    ].join("\n");

    const chunks = splitVideoSummaryText(subtitles, 45);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n")).toBe(subtitles);
    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
  });

  test("uses one final request for a short subtitle track", async () => {
    const requestSummary = jest.fn().mockResolvedValue("final summary");

    const result = await generateCompleteVideoSummary({
      subtitles: "[00:00] short video",
      finalSystemPrompt: "final prompt",
      requestSummary,
      maxChunkLength: 100,
    });

    expect(result).toBe("final summary");
    expect(requestSummary).toHaveBeenCalledTimes(1);
    expect(requestSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "final",
        systemPrompt: "final prompt",
        userContent: expect.stringContaining("[00:00] short video"),
      })
    );
  });

  test("summarizes long subtitles sequentially before the final request", async () => {
    const subtitles = [
      `[00:00] ${"a".repeat(84)}`,
      `[00:10] ${"b".repeat(84)}`,
      `[00:20] ${"c".repeat(84)}`,
    ].join("\n");
    const stages = [];
    const requestSummary = jest.fn(async ({ stage, index, userContent }) => {
      stages.push(stage);
      if (stage === "chunk") {
        return `note-${index + 1} ${userContent.match(/\[\d\d:\d\d\]/)?.[0]}`;
      }
      return "complete final summary";
    });

    const result = await generateCompleteVideoSummary({
      subtitles,
      finalSystemPrompt: "final prompt",
      requestSummary,
      maxChunkLength: 100,
    });

    expect(result).toBe("complete final summary");
    expect(stages).toEqual(["chunk", "chunk", "chunk", "final"]);
    const chunkCalls = requestSummary.mock.calls
      .map(([args]) => args)
      .filter((args) => args.stage === "chunk");
    expect(
      chunkCalls.every(
        (args) => args.maxTokens === VIDEO_SUMMARY_INTERMEDIATE_MAX_TOKENS
      )
    ).toBe(true);
    const finalCall = requestSummary.mock.calls.at(-1)[0];
    expect(finalCall.maxTokens).toBeUndefined();
    expect(finalCall.userContent).toContain("note-1 [00:00]");
    expect(finalCall.userContent).toContain("note-2 [00:10]");
    expect(finalCall.userContent).toContain("note-3 [00:20]");
  });

  test("recursively reduces intermediate notes that exceed the chunk limit", async () => {
    const subtitles = [
      `[00:00] ${"a".repeat(28)}`,
      `[00:10] ${"b".repeat(28)}`,
      `[00:20] ${"c".repeat(28)}`,
      `[00:30] ${"d".repeat(28)}`,
    ].join("\n");
    const requestSummary = jest.fn(async ({ stage, index, level }) => {
      if (stage === "chunk") return `note-${index}-${"n".repeat(42)}`;
      if (stage === "merge") return `merged-${level}-${index}`;
      return "recursive final summary";
    });

    const result = await generateCompleteVideoSummary({
      subtitles,
      finalSystemPrompt: "final prompt",
      requestSummary,
      maxChunkLength: 80,
    });

    expect(result).toBe("recursive final summary");
    expect(
      requestSummary.mock.calls.some(([args]) => args.stage === "merge")
    ).toBe(true);
    expect(requestSummary.mock.calls.at(-1)[0].stage).toBe("final");
  });

  test("fails the whole summary when any chunk request fails", async () => {
    const subtitles = [
      `[00:00] ${"a".repeat(28)}`,
      `[00:10] ${"b".repeat(28)}`,
    ].join("\n");
    const requestSummary = jest.fn(async ({ stage, index }) => {
      if (stage === "chunk" && index === 1) {
        throw new Error("chunk request failed");
      }
      return "first note";
    });

    await expect(
      generateCompleteVideoSummary({
        subtitles,
        finalSystemPrompt: "final prompt",
        requestSummary,
        maxChunkLength: 45,
      })
    ).rejects.toThrow("chunk request failed");
    expect(
      requestSummary.mock.calls.some(([args]) => args.stage === "final")
    ).toBe(false);
  });

  test("rejects an empty intermediate response instead of returning a partial result", async () => {
    const requestSummary = jest.fn(async ({ stage, index }) => {
      if (stage === "chunk" && index === 1) return "";
      return "first note";
    });

    await expect(
      generateCompleteVideoSummary({
        subtitles: `[00:00] ${"a".repeat(28)}\n[00:10] ${"b".repeat(28)}`,
        finalSystemPrompt: "final prompt",
        requestSummary,
        maxChunkLength: 45,
      })
    ).rejects.toThrow("empty response");
  });
});
