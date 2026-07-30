/**
 * @file webSummary.js
 * @description 网页内容提取与总结功能模块。提供从当前网页提取主要文本内容、
 * 通过 background script 调用 AI API 生成网页总结的能力。
 */

import { sendBgMsg } from "./msg";
import { BRIDGE_SUMMARIZE_PAGE } from "../config/msg";

// 提取文本时排除的选择器（噪声元素）
const NOISE_SELECTOR = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "nav",
  "footer",
  "header",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[role='complementary']",
  "[role='contentinfo']",
  ".nav",
  ".navbar",
  ".sidebar",
  ".footer",
  ".header",
  ".menu",
  ".advertisement",
  ".ad",
  ".ads",
  ".cookie-banner",
  ".popup",
  ".modal",
  "[aria-hidden='true']",
  "[hidden]",
].join(", ");

// 优先提取的主内容选择器（按优先级从高到低）
const MAIN_CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".post-content",
  ".article-content",
  ".entry-content",
  ".content",
  "#content",
];

// 提取文本的最大字符数限制
const MAX_CONTENT_LENGTH = 15000;

/**
 * 清理 DOM 节点中的噪声元素，返回纯净的文本内容。
 * @param {Element} root 根 DOM 节点
 * @returns {string} 清理后的纯文本
 */
function cleanAndExtractText(root) {
  if (!root) return "";

  // 克隆节点以避免修改原始 DOM
  const clone = root.cloneNode(true);

  // 移除所有噪声元素
  const noiseElements = clone.querySelectorAll(NOISE_SELECTOR);
  noiseElements.forEach((el) => el.remove());

  // 将 block 元素转换为换行符分隔，保留段落结构
  const blockElements = clone.querySelectorAll(
    "p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr, dt, dd, section"
  );
  blockElements.forEach((el) => {
    el.insertAdjacentText("beforebegin", "\n");
    el.insertAdjacentText("afterend", "\n");
  });

  // 获取纯文本并清理多余空白
  let text = clone.textContent || "";
  text = text
    .replace(/[ \t]+/g, " ")          // 合并连续空格/制表符
    .replace(/\n[ \t]+/g, "\n")       // 移除行首空白
    .replace(/\n{3,}/g, "\n\n")       // 最多保留两个换行
    .trim();

  return text;
}

/**
 * 尝试使用指定的选择器从文档中提取主要内容。
 * @param {string} selector CSS 选择器
 * @returns {string|null} 提取到的文本；若内容为空则返回 null
 */
function tryExtractBySelector(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;

  const text = cleanAndExtractText(el);
  // 内容过短视为无效提取结果
  return text.length > 50 ? text : null;
}

/**
 * 提取当前网页的主要文本内容。
 * 使用多种策略：先尝试提取 article/main 等语义标签内容，降级到 body 文本。
 * @returns {string} 清理后的纯文本，限制长度约 MAX_CONTENT_LENGTH 字符
 */
export function extractPageContent() {
  // 策略 1：优先尝试语义化主内容标签
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const text = tryExtractBySelector(selector);
    if (text) {
      return text.slice(0, MAX_CONTENT_LENGTH);
    }
  }

  // 策略 2：降级到 document.body
  const bodyText = cleanAndExtractText(document.body);
  return bodyText.slice(0, MAX_CONTENT_LENGTH);
}

/**
 * 通过 background script 请求 AI API 生成网页总结。
 * @param {string} content 提取到的网页文本内容
 * @param {Function} callback 回调函数，接收 (error, result) 两个参数
 *   - error: 错误信息字符串，成功时为 null
 *   - result: 总结结果字符串，失败时为 null
 */
export async function requestWebSummary(content, callback) {
  try {
    const result = await sendBgMsg(BRIDGE_SUMMARIZE_PAGE, { content });

    if (result?.error) {
      callback(result.error, null);
    } else {
      callback(null, result?.summary || "");
    }
  } catch (err) {
    callback(err?.message || "Unknown error", null);
  }
}

/**
 * 从任意结构中递归提取最可能的总结正文字段。
 * @param {*} data 已解析的 JSON 值
 * @returns {string} 提取到的文本；无法提取时返回空串
 */
function pickSummaryField(data) {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    return data
      .map((item) => pickSummaryField(item))
      .filter(Boolean)
      .join("\n\n");
  }
  if (data && typeof data === "object") {
    const keys = [
      "summary",
      "content",
      "text",
      "result",
      "output",
      "answer",
      "summary_text",
    ];
    for (const key of keys) {
      if (typeof data[key] === "string" && data[key].trim()) {
        return data[key];
      }
      if (data[key] && typeof data[key] === "object") {
        const nested = pickSummaryField(data[key]);
        if (nested) return nested;
      }
    }
  }
  return "";
}

/**
 * 规范化 AI 返回的总结文本，兜底处理模型把结果包进 JSON 或代码围栏的情况，
 * 使弹窗始终拿到干净的 Markdown/纯文本用于渲染。
 * @param {string} raw AI 返回的原始文本
 * @returns {string} 规范化后的可读文本
 */
export function normalizeSummaryText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let text = raw.trim();

  // 去除整体包裹的 ```json / ```markdown / ``` 代码围栏
  const fenceMatch = text.match(
    /^```(?:json|markdown|md)?\s*\n?([\s\S]*?)\n?```$/i
  );
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // 若整体是 JSON 对象/数组且含常见文本字段，提取其中真正的正文
  if (/^[[{]/.test(text)) {
    try {
      const data = JSON.parse(text);
      const picked = pickSummaryField(data);
      if (picked) {
        text = picked;
      }
    } catch {
      // 非合法 JSON，保持原文
    }
  }

  return text.trim();
}

/**
 * 解析 AI 返回的 Markdown 格式总结文本，提取结构化数据。
 * @param {string} markdownText AI 返回的 Markdown 格式总结
 * @returns {Object} 结构化总结对象 { coreOverview, keyPoints, details, rawText }
 */
export function parseSummaryMarkdown(markdownText) {
  const result = {
    coreOverview: "",
    keyPoints: [],
    details: "",
    rawText: markdownText || "",
  };

  if (!markdownText) return result;

  const text = markdownText.trim();

  const sectionPattern = (keywords) =>
    new RegExp(
      "##\\s*(?:" + keywords + ")[^\\n]*\\n([\\s\\S]*?)(?=\\n##|\\n---|$)",
      "i"
    );

  // 提取 "## Core Overview" 段落
  const overviewMatch = text.match(sectionPattern("Core Overview|核心概述"));
  if (overviewMatch) {
    result.coreOverview = overviewMatch[1].trim();
  }

  // 提取 "## Key Points" 段落
  const keyPointsMatch = text.match(sectionPattern("Key Points|要点"));
  if (keyPointsMatch) {
    const keyPointsText = keyPointsMatch[1].trim();
    // 解析每个要点（以 "- " 或数字列表开头的行）
    result.keyPoints = keyPointsText
      .split(/\n/)
      .map((line) =>
        line.replace(/^\s*[-*]\s*/, "").replace(/^\s*\d+\.\s*/, "").trim()
      )
      .filter(Boolean);
  }

  // 提取 "## Details" 段落
  const detailsMatch = text.match(sectionPattern("Details|详情"));
  if (detailsMatch) {
    result.details = detailsMatch[1].trim();
  }

  return result;
}
