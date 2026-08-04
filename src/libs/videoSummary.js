/**
 * @file videoSummary.js
 * @description YouTube 视频总结核心逻辑模块。
 * 负责收集字幕数据、格式化提示词、通过 background script 请求 AI 生成视频总结，以及解析总结响应。
 */

import { BRIDGE_VIDEO_SUMMARY } from "../config/msg.js";
import { cleanTimedText } from "../subtitle/youtubeSubtitleProcessing.js";
import { sendBgMsg } from "./msg.js";

/**
 * 将 YouTube json3 原始字幕事件转换为带时间戳的原文字幕条目。
 * @param {Array<object>} events YouTube 原始字幕事件
 * @returns {Array<{ start: number, end: number, text: string }>} 原文字幕数据
 */
function collectOriginalSubtitleEvents(events) {
  if (!Array.isArray(events)) return [];

  return events
    .map(({ tStartMs = 0, dDurationMs = 0, segs = [] } = {}) => ({
      start: tStartMs,
      end: tStartMs + dDurationMs,
      text: cleanTimedText(segs.map((seg) => seg?.utf8 || "").join("")),
    }))
    .filter((subtitle) => subtitle.text);
}

/**
 * 收集当前视频的原始字幕数据（含时间戳）。
 * 优先使用完整的 YouTube 原始字幕事件，不依赖字幕翻译进度。
 * @returns {Array<{ start: number, end: number, text: string }>} 字幕数据数组
 */
export function collectSubtitleData() {
  const manager = window.__kissYouTubeSubtitleList;
  if (!manager) return [];

  const originalSubtitles = collectOriginalSubtitleEvents(
    manager.rawSubtitleEvents
  );
  if (originalSubtitles.length > 0) {
    return originalSubtitles;
  }

  if (
    Array.isArray(manager.bilingualSubtitles) &&
    manager.bilingualSubtitles.length > 0
  ) {
    return manager.bilingualSubtitles.map((sub) => ({
      start: sub.start,
      end: sub.end,
      text: sub.text || "",
    }));
  }

  return [];
}

/**
 * 将毫秒时间戳格式化为 [MM:SS] 或 [HH:MM:SS] 格式
 * @param {number} millis 毫秒时间戳
 * @returns {string} 格式化后的时间字符串
 */
function formatTimestamp(millis) {
  const totalSeconds = Math.floor(millis / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, "0");

  if (hours > 0) {
    return `[${pad(hours)}:${pad(minutes)}:${pad(seconds)}]`;
  }
  return `[${pad(minutes)}:${pad(seconds)}]`;
}

/**
 * 将字幕数据格式化为提示词输入（带时间戳的字幕文本）。
 * 保留完整字幕；超过模型安全长度时由后台视频总结流水线负责分块处理。
 * @param {Array<{ start: number, end: number, text: string }>} subtitles 字幕数据
 * @returns {string} 格式化后的带时间戳字幕文本
 */
export function formatSubtitlesForPrompt(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return "";
  }

  const lines = [];

  for (const sub of subtitles) {
    const timestamp = formatTimestamp(sub.start);
    const line = `${timestamp} ${sub.text || ""}`;
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 通过 background script 请求 API 生成视频总结。
 * @param {string} formattedSubs 格式化后的带时间戳字幕文本
 * @param {Function} callback 接收结果的回调函数 (result: { summary?: string, error?: string })
 * @returns {Promise<{ summary?: string, error?: string }>}
 */
export async function requestVideoSummary(formattedSubs, callback) {
  try {
    const response = await sendBgMsg(BRIDGE_VIDEO_SUMMARY, { subtitles: formattedSubs });

    if (typeof callback === "function") {
      callback(response);
    }

    return response;
  } catch (err) {
    const errorResult = { error: err?.message || "Failed to request video summary" };
    if (typeof callback === "function") {
      callback(errorResult);
    }
    return errorResult;
  }
}

/**
 * 解析视频总结响应，提取时间戳和分段信息。
 * @param {string} responseText AI 返回的 Markdown 格式总结文本
 * @returns {Object} 结构化数据 { mainPoints: string[], sections: Array<{ title, startTime, endTime, content }>, highlights: string[], rawText: string }
 */
export function parseVideoSummaryResponse(responseText) {
  if (!responseText || typeof responseText !== "string") {
    return { mainPoints: [], sections: [], highlights: [], rawText: responseText || "" };
  }

  const result = {
    mainPoints: [],
    sections: [],
    highlights: [],
    rawText: responseText,
  };

  /**
   * 将时间字符串转换为毫秒
   * @param {string} timeStr 时间字符串，如 "01:23" 或 "01:23:45"
   * @returns {number} 毫秒时间戳
   */
  function timeToMillis(timeStr) {
    const parts = timeStr.split(":").map(Number);
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    if (parts.length === 2) {
      return (parts[0] * 60 + parts[1]) * 1000;
    }
    return 0;
  }

  // 按行解析
  const lines = responseText.split("\n");
  let currentSection = null;
  let inMainPoints = false;
  let inHighlights = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 检测主要观点区域
    if (/^##\s*main\s*points/i.test(trimmedLine) || /^##\s*主要观点/i.test(trimmedLine) || /^##\s*主なポイント/i.test(trimmedLine)) {
      inMainPoints = true;
      inHighlights = false;
      currentSection = null;
      continue;
    }

    // 检测分段详情区域
    if (/^##\s*detailed/i.test(trimmedLine) || /^##\s*分段详情/i.test(trimmedLine) || /^##\s*セクション詳細/i.test(trimmedLine)) {
      inMainPoints = false;
      inHighlights = false;
      currentSection = null;
      continue;
    }

    // 检测精彩亮点区域
    if (/^##\s*notable/i.test(trimmedLine) || /^##\s*精彩/i.test(trimmedLine) || /^##\s*ハイライト/i.test(trimmedLine)) {
      inMainPoints = false;
      inHighlights = true;
      currentSection = null;
      continue;
    }

    // 检测新的分段标题 (### Section N: Title (Timestamp: XX:XX - XX:XX))，标签兼容中文“时间戳”写法
    const sectionMatch = trimmedLine.match(/^###\s+(?:Section\s+\d+[:：]\s*)?(.+?)(?:\s*[(（](?:Timestamp|时间戳)[:：]?\s*([\d:]+)\s*[-–]\s*([\d:]+)[)）])?$/i);
    if (sectionMatch) {
      inMainPoints = false;
      inHighlights = false;
      currentSection = {
        title: sectionMatch[1].trim(),
        startTime: sectionMatch[2] ? timeToMillis(sectionMatch[2]) : null,
        endTime: sectionMatch[3] ? timeToMillis(sectionMatch[3]) : null,
        content: [],
      };
      result.sections.push(currentSection);
      continue;
    }

    // 收集主要观点
    if (inMainPoints && /^[-*•]\s*/.test(trimmedLine)) {
      result.mainPoints.push(trimmedLine.replace(/^[-*•]\s*/, ""));
      continue;
    }

    // 收集精彩亮点
    if (inHighlights && /^[-*•]\s*/.test(trimmedLine)) {
      result.highlights.push(trimmedLine.replace(/^[-*•]\s*/, ""));
      continue;
    }

    // 收集分段内容
    if (currentSection && /^[-*•]\s*/.test(trimmedLine)) {
      currentSection.content.push(trimmedLine.replace(/^[-*•]\s*/, ""));
      continue;
    }
  }

  return result;
}
