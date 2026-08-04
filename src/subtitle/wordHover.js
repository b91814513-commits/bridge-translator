import { apiMicrosoftDict } from "../apis/index.js";
import { logger } from "../libs/log.js";
import { trustedTypesHelper } from "../libs/trustedTypes.js";

const TOOLTIP_THEME_PROPERTIES = [
  "--kt-bg",
  "--kt-border",
  "--kt-text",
  "--kt-subtext",
  "--kt-primary",
  "--kt-time-bg",
  "--kt-divider",
  "--kt-btn-color",
  "--kt-primary-contrast",
];

/**
 * 动态向网页 document.head 中注入生词 hover 及详情气泡弹窗所需的 CSS 样式
 */
export const addWordHoverStyles = () => {
  // 如果已经注入过该样式表，直接返回，避免重复创建
  if (document.getElementById("kiss-word-hover-styles")) return;

  const style = document.createElement("style");
  style.id = "kiss-word-hover-styles";
  style.textContent = `
    /* 鼠标 hover 的单词样式：呈现下划线，指示可点击查词 */
    .kiss-word-hover {
      cursor: pointer;
      text-decoration: underline;
      text-decoration-color: var(--kt-primary, #ec407a);
      text-decoration-thickness: 2px;
    }

    .kiss-word-collecting {
      opacity: 0.72;
    }

    /* 查词气泡弹窗主体样式 */
    .kiss-word-tooltip {
      position: fixed;
      background: var(--kt-bg, rgba(255, 240, 245, 0.96));
      color: var(--kt-text, #37474f);
      border-radius: 8px;
      padding: 14px;
      font-size: 14px;
      line-height: 1.45;
      z-index: 2147483647;
      max-width: 300px;
      word-wrap: break-word;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      backdrop-filter: blur(10px);
      border: var(--kt-border, 1px solid rgba(236, 64, 122, 0.15));
    }

    /* 气泡弹窗头部（包含单词名和关闭按钮） */
    .kiss-word-tooltip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: bold;
      font-size: 16px;
      color: var(--kt-primary, #ec407a);
    }

    /* 关闭气泡弹窗的 X 按钮 */
    .kiss-word-tooltip-close {
      background: none;
      border: none;
      color: var(--kt-subtext, #607d8b);
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      margin-left: 10px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .kiss-word-tooltip-close:hover {
      color: var(--kt-text, #37474f);
      background: var(--kt-time-bg, rgba(236, 64, 122, 0.1));
      border-radius: 50%;
    }

    /* 释义加载中状态文案 */
    .kiss-word-loading {
      color: var(--kt-subtext, #607d8b);
      font-style: italic;
    }

    /* 单词词性释义行 */
    .kiss-word-definition {
      margin: 4px 0;
    }

    /* 词性前缀标记（如 n. / v. 等） */
    .kiss-word-pos {
      color: var(--kt-primary, #ec407a);
      font-weight: bold;
    }

    /* 音标字符样式 */
    .kiss-word-phonetic {
      color: var(--kt-subtext, #607d8b);
      font-style: italic;
      margin-right: 10px;
    }

    /* 例句包裹区 */
    .kiss-word-example {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid var(--kt-divider, rgba(244, 143, 177, 0.25));
    }

    .kiss-word-example-title {
      font-weight: bold;
      margin-bottom: 5px;
    }

    /* 例句英文正文 */
    .kiss-word-example-sentence {
      margin-bottom: 3px;
    }

    /* 例句中文翻译 */
    .kiss-word-example-translation {
      color: var(--kt-subtext, #607d8b);
      font-style: italic;
    }

    .kiss-word-tooltip-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--kt-divider, rgba(244, 143, 177, 0.25));
    }

    .kiss-word-favorite-button {
      min-height: 32px;
      padding: 6px 11px;
      border: 1px solid var(--kt-primary, #ec407a);
      border-radius: 4px;
      background: transparent;
      color: var(--kt-primary, #ec407a);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }

    .kiss-word-favorite-button[data-saved="true"] {
      background: var(--kt-primary, #ec407a);
      color: var(--kt-primary-contrast, white);
    }

    .kiss-word-favorite-button:not(:disabled):hover {
      background: var(--kt-time-bg, rgba(236, 64, 122, 0.1));
    }

    .kiss-word-favorite-button[data-saved="true"]:not(:disabled):hover {
      filter: brightness(0.96);
    }

    .kiss-word-favorite-button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    .kiss-word-toast {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 10px 12px;
      border: var(--kt-border, 1px solid rgba(236, 64, 122, 0.15));
      border-radius: 8px;
      background: var(--kt-bg, rgba(255, 240, 245, 0.96));
      color: var(--kt-text, #37474f);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      backdrop-filter: blur(10px);
      font-size: 13px;
      line-height: 1.4;
      animation: kiss-word-toast-in 160ms ease-out;
    }

    .kiss-word-toast button {
      border: 0;
      min-height: 28px;
      padding: 4px 7px;
      border-radius: 4px;
      background: var(--kt-time-bg, rgba(236, 64, 122, 0.1));
      color: var(--kt-primary, #ec407a);
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }

    @keyframes kiss-word-toast-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
};

/**
 * 使用正则表达式，将英文字幕文本中的每一个独立英文单词（包括带单引号/撇号的如 it's）使用 span 标签包裹。
 *
 * @param {string} text - 原文字幕字符串
 * @returns {string} 替换为带 span 标签的 HTML 字符串
 */
export function wrapWordsWithSpans(text) {
  return String(text || "").replace(
    /\b([a-zA-Z]+(?:'[a-zA-Z]+)?)\b/g,
    '<span class="kiss-subtitle-word" data-word="$1">$1</span>'
  );
}

export class WordTooltipController {
  constructor({
    getVideoContainer,
    getTimestamp,
    onToggleFavorite = null,
    onCollectFavorite = null,
    onRemoveFavorite = null,
    isFavorite = () => false,
    getThemeElement = () => null,
    t = (_, fallback) => fallback,
  }) {
    this.getVideoContainer = getVideoContainer;
    this.getTimestamp = getTimestamp;
    this.onToggleFavorite = onToggleFavorite;
    this.onCollectFavorite = onCollectFavorite;
    this.onRemoveFavorite = onRemoveFavorite;
    this.isFavorite = isFavorite;
    this.getThemeElement = getThemeElement;
    this.t = t;
    this.tooltipEl = null;
    this.hoverTimeout = null;
    this.activeWordEl = null;
    this.lookupId = 0;
    this.currentLookup = null;
    this.currentAnchorEl = null;
    this.toastTimer = null;
  }

  attachSpanListeners(
    root,
    getTimestamp = this.getTimestamp,
    getContext = () => ({})
  ) {
    if (!root) return;

    const spans = root.querySelectorAll(".kiss-subtitle-word");
    spans.forEach((span) => {
      if (span.dataset.kissListenerAttached) return;
      const enterHandler = (event) =>
        this.#handleWordHover(event, getTimestamp, getContext);
      const leaveHandler = (event) => this.#handleWordHoverOut(event);
      span.addEventListener("pointerenter", enterHandler);
      span.addEventListener("pointerleave", leaveHandler);
      if (this.onCollectFavorite) {
        span.addEventListener("click", (event) =>
          this.#handleWordClick(event, getTimestamp, getContext)
        );
      }
      span.dataset.kissListenerAttached = "1";
    });
  }

  destroy() {
    this.clearHoverState();
    clearTimeout(this.toastTimer);
    document.querySelector(".kiss-word-toast")?.remove();
  }

  clearHoverState() {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
    this.activeWordEl?.classList.remove("kiss-word-hover");
    this.activeWordEl = null;
    this.hideWordTooltip();
  }

  #handleWordHover(event, getTimestamp, getContext) {
    const target = event.target;
    if (!target.classList.contains("kiss-subtitle-word")) return;

    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }

    target.classList.add("kiss-word-hover");
    this.activeWordEl = target;

    this.hoverTimeout = setTimeout(() => {
      this.showWordTooltip(target.dataset.word, {
        timestamp: getTimestamp?.() ?? 0,
        anchorEl: target,
        ...getContext?.(),
      });
    }, 300);
  }

  #handleWordHoverOut(event) {
    const target = event.target;
    if (!target.classList.contains("kiss-subtitle-word")) return;

    target.classList.remove("kiss-word-hover");
    if (this.activeWordEl === target) {
      this.activeWordEl = null;
    }

    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }

    this.hoverTimeout = setTimeout(() => {
      this.hideWordTooltip();
    }, 500);
  }

  async #handleWordClick(event, getTimestamp, getContext) {
    const target = event.target;
    if (
      !target.classList.contains("kiss-subtitle-word") ||
      target.dataset.kissCollecting === "true"
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const word = target.dataset.word;
    this.currentAnchorEl = target;
    const sameLookup =
      this.currentLookup?.word?.toLocaleLowerCase() ===
      word?.toLocaleLowerCase();
    const context = getContext?.() || {};
    const lookup = {
      word,
      phonetic: sameLookup ? this.currentLookup.phonetic : "",
      definition: sameLookup ? this.currentLookup.definition : "",
      examples: sameLookup ? this.currentLookup.examples : [],
      timestamp: getTimestamp?.() ?? 0,
      originalText: context.originalText || "",
      translation: context.translation || "",
    };

    target.dataset.kissCollecting = "true";
    target.classList.add("kiss-word-collecting");
    try {
      const result = await this.onCollectFavorite(lookup);
      if (result?.saved !== true) throw new Error("Favorite was not saved");
      this.#setFavoriteButtonState(true);
      this.#showToast(
        `${this.t("vocabulary_added", "已加入")} · ${this.t("this_video_total", "本视频共")} ${result.videoCount || 0} ${this.t("vocabulary_count_unit", "个")}`,
        this.onRemoveFavorite
          ? async () => {
              await this.onRemoveFavorite(lookup);
              this.#setFavoriteButtonState(false);
            }
          : null
      );
    } catch (error) {
      logger.info("Favorite word update failed:", error);
      this.#showToast(this.t("save_failed", "保存失败，请重试"));
    } finally {
      delete target.dataset.kissCollecting;
      target.classList.remove("kiss-word-collecting");
    }
  }

  async showWordTooltip(word, context = {}) {
    const lookupId = ++this.lookupId;
    if (this.tooltipEl) {
      this.tooltipEl.remove();
    }

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.className = "kiss-word-tooltip";
    this.currentLookup = {
      word,
      phonetic: "",
      definition: "",
      examples: [],
      timestamp: context.timestamp || 0,
      originalText: context.originalText || "",
      translation: context.translation || "",
    };
    this.currentAnchorEl = context.anchorEl || null;
    this.#renderMessage(word, this.t("looking_up", "Looking up..."), true);

    const videoContainer = this.getVideoContainer?.();
    if (videoContainer) {
      const containerRect = videoContainer.getBoundingClientRect();
      const tooltipWidth = 300;
      const tooltipHeight = 400;

      const left = containerRect.right - tooltipWidth - 45;
      const top = containerRect.top + 20;

      const maxLeft = window.innerWidth - tooltipWidth - 10;
      this.tooltipEl.style.left = Math.min(maxLeft, Math.max(10, left)) + "px";
      this.tooltipEl.style.top = Math.max(10, top) + "px";
      this.tooltipEl.style.maxWidth = tooltipWidth + "px";
      this.tooltipEl.style.maxHeight = tooltipHeight + "px";
      this.tooltipEl.style.overflow = "auto";
    }

    this.#applyThemeAndTypography(this.tooltipEl, this.currentAnchorEl);

    document.body.appendChild(this.tooltipEl);
    this.tooltipEl.addEventListener("pointerenter", () => {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    });
    this.tooltipEl.addEventListener("pointerleave", () => {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = setTimeout(() => this.hideWordTooltip(), 500);
    });

    try {
      const dictResult = await apiMicrosoftDict(word);
      if (lookupId !== this.lookupId || !this.tooltipEl) return;
      const { phonetic, definition, examples } =
        this.#extractDictionaryData(dictResult);
      this.currentLookup = {
        ...this.currentLookup,
        phonetic,
        definition,
        examples,
      };
      this.#renderDictionaryResult(word, dictResult);
    } catch (error) {
      logger.info("Dictionary lookup failed for word:", word, error);
      if (lookupId !== this.lookupId || !this.tooltipEl) return;
      this.#renderMessage(
        word,
        this.t("dictionary_lookup_failed", "Failed to load definition")
      );
    }
  }

  hideWordTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }

  #applyThemeAndTypography(element, anchorEl = null) {
    if (!element || typeof getComputedStyle !== "function") return;

    const themeElement = this.getThemeElement?.();
    if (themeElement) {
      const themeStyle = getComputedStyle(themeElement);
      TOOLTIP_THEME_PROPERTIES.forEach((property) => {
        const value = themeStyle.getPropertyValue(property).trim();
        if (value) element.style.setProperty(property, value);
      });
    }

    const fontSource = anchorEl || themeElement;
    if (!fontSource) return;
    const fontFamily = getComputedStyle(fontSource).fontFamily;
    if (fontFamily) element.style.fontFamily = fontFamily;
  }

  #renderMessage(word, message, loading = false) {
    if (!this.tooltipEl) return;
    this.tooltipEl.innerHTML = trustedTypesHelper.createHTML(
      `<div class="kiss-word-tooltip-header"><span>${word}</span><button class="kiss-word-tooltip-close" type="button">×</button></div><div class="${loading ? "kiss-word-loading" : "kiss-word-definition"}">${message}</div>`
    );
    this.#attachTooltipActions();
  }

  #extractDictionaryData(dictResult) {
    let phonetic = "";
    if (dictResult && dictResult.aus) {
      const usPhonetic = dictResult.aus.find((au) => au.key === "美");
      if (usPhonetic && usPhonetic.phonetic) {
        phonetic = usPhonetic.phonetic;
      } else if (dictResult.aus.length > 0 && dictResult.aus[0].phonetic) {
        phonetic = dictResult.aus[0].phonetic;
      }
    }

    let definition = "";
    if (dictResult && dictResult.trs) {
      definition = dictResult.trs
        .slice(0, 3)
        .map((tr) => `${tr.pos ? tr.pos + " " : ""}${tr.def}`)
        .join("; ");
    }

    let examples = [];
    if (dictResult && dictResult.sentences) {
      examples = dictResult.sentences.slice(0, 2).map((sentence) => ({
        eng: sentence.eng,
        chs: sentence.chs,
      }));
    }

    return { phonetic, definition, examples };
  }

  #renderDictionaryResult(word, dictResult) {
    if (
      dictResult &&
      (dictResult.trs || dictResult.aus || dictResult.sentences)
    ) {
      let content = `<div class="kiss-word-tooltip-header">
          <span>${word}</span>
          <button class="kiss-word-tooltip-close" type="button">×</button>
        </div>`;

      if (dictResult.aus && dictResult.aus.length > 0) {
        content += "<div>";
        dictResult.aus.forEach((au) => {
          if (au.phonetic) {
            content += `<span class="kiss-word-phonetic">${au.phonetic}</span>`;
          }
        });
        content += "</div>";
      }

      if (dictResult.trs) {
        dictResult.trs.slice(0, 3).forEach((tr) => {
          content += `<div class="kiss-word-definition">${tr.pos ? '<span class="kiss-word-pos">' + tr.pos + "</span> " : ""}${tr.def}</div>`;
        });
      }

      if (dictResult.sentences && dictResult.sentences.length > 0) {
        content += `<div class="kiss-word-example">
            <div class="kiss-word-example-title">例句</div>`;
        dictResult.sentences.slice(0, 2).forEach((sentence) => {
          content += `<div class="kiss-word-example-sentence">${sentence.eng}</div>
              <div class="kiss-word-example-translation">${sentence.chs}</div>`;
        });
        content += "</div>";
      }

      if (this.tooltipEl) {
        this.tooltipEl.innerHTML = trustedTypesHelper.createHTML(content);
        this.#attachTooltipActions();
      }
      return;
    }

    if (this.tooltipEl) {
      this.tooltipEl.innerHTML =
        trustedTypesHelper.createHTML(`<div class="kiss-word-tooltip-header">
          <span>${word}</span>
          <button class="kiss-word-tooltip-close" type="button">×</button>
        </div>
        <div class="kiss-word-definition">No definition found</div>`);
      this.#attachTooltipActions();
    }
  }

  #attachTooltipActions() {
    if (!this.tooltipEl || !this.currentLookup) return;
    this.tooltipEl
      .querySelector(".kiss-word-tooltip-close")
      ?.addEventListener("click", () => this.hideWordTooltip());
    if (!this.onToggleFavorite) return;

    const actions = document.createElement("div");
    actions.className = "kiss-word-tooltip-actions";
    const button = document.createElement("button");
    const saved = this.isFavorite(this.currentLookup.word);
    button.type = "button";
    button.className = "kiss-word-favorite-button";
    button.dataset.saved = String(saved);
    button.textContent = saved
      ? `★ ${this.t("saved", "已收藏")}`
      : `☆ ${this.t("collect", "收藏")}`;
    button.title = saved
      ? this.t("remove_from_video_vocabulary", "从本视频生词本移除")
      : this.t("add_to_video_vocabulary", "加入本视频生词本");
    button.addEventListener("click", async () => {
      const lookup = { ...this.currentLookup };
      button.disabled = true;
      try {
        const result = await this.onToggleFavorite(lookup);
        const nextSaved = result?.saved === true;
        this.#setFavoriteButtonState(nextSaved);
        if (nextSaved) {
          this.#showToast(
            `${this.t("vocabulary_added", "已加入")} · ${this.t("this_video_total", "本视频共")} ${result.videoCount} ${this.t("vocabulary_count_unit", "个")}`,
            async () => {
              await this.onToggleFavorite(lookup);
            }
          );
        } else {
          this.#showToast(this.t("vocabulary_removed", "已从本视频生词本移除"));
        }
      } catch (error) {
        logger.info("Favorite word update failed:", error);
        this.#showToast(this.t("save_failed", "保存失败，请重试"));
      } finally {
        button.disabled = false;
      }
    });
    actions.appendChild(button);
    this.tooltipEl.appendChild(actions);
  }

  #setFavoriteButtonState(saved) {
    const button = this.tooltipEl?.querySelector(".kiss-word-favorite-button");
    if (!button) return;
    button.dataset.saved = String(saved);
    button.textContent = saved
      ? `★ ${this.t("saved", "已收藏")}`
      : `☆ ${this.t("collect", "收藏")}`;
  }

  #showToast(message, onUndo = null) {
    clearTimeout(this.toastTimer);
    document.querySelector(".kiss-word-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "kiss-word-toast";
    this.#applyThemeAndTypography(toast, this.currentAnchorEl);
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
    if (onUndo) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.textContent = this.t("undo", "撤销");
      undo.addEventListener("click", async () => {
        await onUndo();
        toast.remove();
      });
      toast.appendChild(undo);
    }
    document.body.appendChild(toast);
    this.#positionToast(toast);
    this.toastTimer = setTimeout(() => toast.remove(), 4200);
  }

  #positionToast(toast) {
    const margin = 10;
    const gap = 8;
    toast.style.visibility = "hidden";

    const toastRect = toast.getBoundingClientRect();
    const toastWidth = toastRect.width || toast.offsetWidth;
    const toastHeight = toastRect.height || toast.offsetHeight;
    const tooltipRect = this.tooltipEl?.isConnected
      ? this.tooltipEl.getBoundingClientRect()
      : null;
    const hasTooltipAnchor = Boolean(
      tooltipRect && (tooltipRect.width || tooltipRect.height)
    );
    const wordRect = this.currentAnchorEl?.getBoundingClientRect?.();

    let left;
    let top;
    if (hasTooltipAnchor) {
      left = tooltipRect.right - toastWidth;
      const below = tooltipRect.bottom + gap;
      const above = tooltipRect.top - toastHeight - gap;
      top = below + toastHeight <= window.innerHeight - margin ? below : above;
    } else if (wordRect) {
      left = wordRect.left + (wordRect.width - toastWidth) / 2;
      const above = wordRect.top - toastHeight - gap;
      const below = wordRect.bottom + gap;
      top = above >= margin ? above : below;
    } else {
      left = (window.innerWidth - toastWidth) / 2;
      top = margin;
    }

    const maxLeft = Math.max(margin, window.innerWidth - toastWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - toastHeight - margin);
    toast.style.left = `${Math.min(maxLeft, Math.max(margin, left))}px`;
    toast.style.top = `${Math.min(maxTop, Math.max(margin, top))}px`;
    toast.style.visibility = "visible";
  }
}
