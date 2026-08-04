import { logger } from "../libs/log.js";
import { downloadBlobFile } from "../libs/utils.js";
import { buildBilingualVtt } from "./vtt.js";
import { getSettingWithDefault } from "../libs/storage.js";
import { trustedTypesHelper } from "../libs/trustedTypes.js";
import {
  getFavoriteWords,
  getVideoFavoriteEntries,
  hasFavoriteOccurrence,
  removeFavoriteOccurrence,
  saveFavoriteWord,
  subscribeFavoriteWords,
} from "../libs/favWords.js";
import {
  addWordHoverStyles,
  WordTooltipController,
  wrapWordsWithSpans,
} from "./wordHover.js";
import {
  collectSubtitleData,
  formatSubtitlesForPrompt,
  requestVideoSummary,
  parseVideoSummaryResponse,
} from "../libs/videoSummary.js";

const LIGHT_THEME_VARS = {
  "--kt-bg": "rgba(255, 240, 245, 0.92)",
  "--kt-border": "1px solid rgba(236, 64, 122, 0.15)",
  "--kt-text": "#37474F",
  "--kt-subtext": "#607D8B",
  "--kt-primary": "#EC407A",
  "--kt-time-bg": "rgba(236, 64, 122, 0.1)",
  "--kt-divider": "rgba(244, 143, 177, 0.25)",
  "--kt-active-bg": "rgba(236, 64, 122, 0.1)",
  "--kt-btn-bg": "var(--kt-primary)",
  "--kt-btn-color": "white",
  "--kt-btn-border": "none",
  "--kt-btn-hover-bg": "rgba(236, 64, 122, 0.85)",
  "--kt-primary-contrast": "white",
};

const DARK_THEME_VARS = {
  "--kt-bg": "rgba(18,18,18,0.85)",
  "--kt-border": "1px solid rgba(255, 255, 255, 0.06)",
  "--kt-text": "#e6e6e6",
  "--kt-subtext": "#bdbdbd",
  "--kt-primary": "#90caf9",
  "--kt-time-bg": "rgba(144,202,249,0.08)",
  "--kt-divider": "rgba(255,255,255,0.06)",
  "--kt-active-bg": "rgba(144,202,249,0.12)",
  "--kt-btn-bg": "linear-gradient(180deg,#0f0f0f,#1b1b1b)",
  "--kt-btn-color": "#e6e6e6",
  "--kt-btn-border": "1px solid rgba(255,255,255,0.04)",
  "--kt-btn-hover-bg": "linear-gradient(180deg,#141414,#262626)",
  "--kt-primary-contrast": "#102027",
};

/**
 * YouTube 字幕列表管理器
 *
 * 主要职责与功能：
 * 1. 负责在 YouTube 原生播放器的右侧/下方“次要推荐内容栏”中动态挂载和管理一个自适应暗黑/浅色主题的双语字幕滚动列表面板。
 * 2. 监听视频播放器的 timeupdate，在 ASR/手动字幕播放时计算高亮并自适应居中滚动对齐（基于 O(log N) 二分搜索）。
 * 3. 支持字幕单词 hover 查词，以及用户明确收藏后的上下文词汇管理。
 * 4. 生词持久化到全局词汇库，并支持按当前视频筛选与导出。
 */
export class YouTubeSubtitleList {
  /**
   * @param {HTMLVideoElement} videoElement YouTube 的原生视频播放器 DOM 节点
   */
  constructor(
    videoElement,
    i18n = () => "",
    { enableHoverLookup = false } = {}
  ) {
    this.videoEl = videoElement;
    this.i18n = i18n;
    this.enableHoverLookup = enableHoverLookup;

    // 将实例暴露到全局，以便 videoSummary 模块可以访问字幕数据
    window.__kissYouTubeSubtitleList = this;

    // --- 数据源缓存 ---
    // 双语字幕主列表数组。结构：{ start: number, end: number, text: string, translation: string }
    this.bilingualSubtitles = [];
    this.rawSubtitleEvents = [];
    this.favoriteWords = {};
    this._favoriteWordsChangedSinceLoad = false;
    // 当前视频生词数组，由全局词汇库按 videoId 派生。
    this.vocabulary = [];

    // --- DOM 节点引用缓存 ---
    this.container = null; // 右侧字幕/生词面板的最外层根容器节点
    this.subtitleTabEl = null; // 字幕 Tab 按钮引用，用于随处理进度刷新标题文案
    this.vocabularyTabEl = null;
    this.subtitleListEl = null; // 字幕列表面板的 DOM 引用
    this.vocabularyListEl = null; // 生词本面板的 DOM 引用
    this.videoSummaryEl = null; // 视频总结面板的 DOM 引用
    this.subtitleScrollContainer = null; // 字幕列表的专用独立纵向滚动容器
    this._cachedSubtitleItems = []; // 缓存每一个字幕行 li 节点引用的数组，避免在滚动同步高亮时高频执行 querySelector 带来的重排 (Reflow) 损耗，提升滚动性能

    // --- 状态管理 ---
    this.subtitleProgress = 0; // 当前字幕断句/处理进度百分比，用于显示在“双语字幕”Tab 后
    this.loopAutoScroll = null; // 自动滚动的定时器 ID
    this.activeTab = "subtitles"; // 当前激活的 Tab: 'subtitles' 或 'vocabulary'
    this._lastActiveIndex = -1; // 上一次高亮的字幕索引位置
    this._virtualHeights = []; // 虚拟列表每一行的缓存高度；未测量行先使用估算值，显示后再用真实高度回写
    this._virtualOffsets = [0]; // 前缀和偏移表，用于通过 scrollTop 快速定位应该渲染的字幕区间
    this._virtualStart = -1; // 当前已渲染窗口的起始字幕索引，避免 scroll 事件重复渲染同一段 DOM
    this._virtualEnd = -1; // 当前已渲染窗口的结束字幕索引（不包含该索引）
    this._virtualRenderRaf = null; // 虚拟列表渲染的 requestAnimationFrame ID，用于把高频滚动合并到下一帧
    this._virtualRenderForce = false; // 是否强制重建当前虚拟窗口；数据或高度变化时需要跳过区间相同的短路判断
    this._estimatedItemHeight = 76; // 字幕行在真实测量前使用的默认高度，保证长列表初始滚动条长度稳定
    this._subtitleItemGap = 4; // li 的 margin-bottom 需要计入虚拟高度，否则偏移量会随行数累积误差
    this._virtualTopPadding = 16; // 模拟原 ul 顶部 padding，保持虚拟化前后的视觉留白一致
    this._virtualBottomPadding = 16; // 模拟原 ul 底部 padding，避免最后一行贴住滚动容器底部
    this._virtualOverscan = 8; // 视口上下额外预渲染的行数，减少快速滚动时的空白闪烁
    this._pendingCenterIndex = -1; // 跳转到未测量高度的行后，等真实高度回写再补一次居中
    this._pendingSubtitleTabScrollIndex = -1; // 字幕 Tab 隐藏期间收到跳转请求时，延后到 Tab 恢复可见后再滚动到目标行
    this._eventListenersAttached = false;
    this._vocabularyDirty = false; // 惰性重绘标志位：若在生词 Tab 隐藏时收录了生词，先置为 true。当用户切换到生词 Tab 时再按需重绘 DOM，避免隐藏 DOM 的无效绘制开销
    this._chunkRenderCancel = null; // 记录当前分块渲染流程的取消回调函数，用于在重置或卸载时随时中断异步渲染流水线
    this._playerResizeObserver = null; // 监听播放器尺寸变化，使右侧字幕列表高度与播放器高度保持一致
    this._playerSizeListenerAttached = false;
    this._wordTooltipController = null; // 右侧列表英文单词 hover 查词控制器

    // --- 视频总结状态 ---
    this._videoSummaryState = "idle"; // 'idle' | 'loading' | 'success' | 'error'
    this._videoSummaryData = null; // 解析后的总结数据
    this._videoSummaryError = ""; // 错误信息
    this._videoSummaryRawText = ""; // AI 返回的原始总结文本

    // --- 交互事件句柄绑定 ---
    this.handleJumpMessage = this.handleJumpMessage.bind(this);
    this.handleSubtitleScroll = this.handleSubtitleScroll.bind(this);
    this.handleContainerMouseEnter = this.handleContainerMouseEnter.bind(this);
    this.handleContainerMouseLeave = this.handleContainerMouseLeave.bind(this);
    this.handleVideoEnded = this.handleVideoEnded.bind(this);
    this.handleVideoPause = this.handleVideoPause.bind(this);
    this.handleVideoPlay = this.handleVideoPlay.bind(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
    // 监听来自扩展配置选项页面等第三方发送的消息，用以点击生词时同步跳转视频进度
    window.addEventListener("message", this.handleJumpMessage);

    this._favoriteWordsUnsubscribe = subscribeFavoriteWords((words) =>
      this._applyFavoriteWords(words, true)
    );
    getFavoriteWords()
      .then((words) => {
        if (!this._favoriteWordsChangedSinceLoad) {
          this._applyFavoriteWords(words);
        }
      })
      .catch((error) => logger.info("Load favorite words failed:", error));

    if (this.enableHoverLookup) {
      addWordHoverStyles();
      this._wordTooltipController = new WordTooltipController({
        getVideoContainer: () => this._getPlayerElement(),
        getTimestamp: () => this.videoEl.currentTime * 1000,
        onToggleFavorite: (wordData) =>
          this._toggleFavoriteFromTooltip(wordData),
        onCollectFavorite: (wordData) =>
          this._collectFavoriteFromTooltip(wordData),
        onRemoveFavorite: (wordData) =>
          this._removeFavoriteFromTooltip(wordData),
        isFavorite: (word) =>
          hasFavoriteOccurrence(
            this.favoriteWords,
            word,
            this._getYouTubeVideoId()
          ),
        getThemeElement: () => this.container,
        t: (key, fallback) => this._t(key, fallback),
      });
    }
  }

  /**
   * 响应外部页面发送的跳转消息，例如从生词本链接跳回视频对应时间点。
   * 使用具名 handler 是为了 destroy 时可以准确 removeEventListener，避免匿名函数残留。
   */
  handleJumpMessage(event) {
    if (event.data && event.data.type === "KISS_TRANSLATOR_JUMP_TO_TIME") {
      this.jumpToTime(event.data.time);
    }
  }

  /**
   * 字幕滚动容器发生滚动时，仅调度下一帧虚拟渲染。
   * 实际 DOM 重建会被 _scheduleVirtualRender 合并，避免滚动过程中每个事件都同步改 DOM。
   */
  handleSubtitleScroll() {
    this._wordTooltipController?.clearHoverState();
    this._scheduleVirtualRender();
  }

  /**
   * 鼠标进入侧栏时暂停自动跟随，方便用户手动浏览或选择字幕文本。
   */
  handleContainerMouseEnter() {
    this.turnOffAutoSub();
  }

  /**
   * 鼠标离开侧栏后恢复自动跟随视频进度。
   */
  handleContainerMouseLeave() {
    this.turnOnAutoSub();
  }

  /**
   * 视频播放结束时关闭自动滚动定时器，避免无意义轮询。
   */
  handleVideoEnded() {
    this.turnOffAutoSub();
  }

  /**
   * 视频暂停时关闭自动滚动定时器；恢复播放时再由 play 事件重新开启。
   */
  handleVideoPause() {
    this.turnOffAutoSub();
  }

  /**
   * 视频开始播放时恢复字幕自动跟随。
   */
  handleVideoPlay() {
    this.turnOnAutoSub();
  }

  handleWindowResize() {
    this._syncContainerHeightToPlayer();
  }

  // ==================================================================================
  // 公有 API: 挂载初始化与数据响应机制
  // ==================================================================================

  /**
   * 初始化字幕面板并启动首次渲染与事件挂载
   * @param {Array} subtitles 初始格式化完毕的字幕数组
   */
  initialize(subtitles, rawSubtitleEvents = [], progressed = 100) {
    this.bilingualSubtitles = subtitles || [];
    this.rawSubtitleEvents = rawSubtitleEvents || [];
    this.subtitleProgress = this._normalizeProgress(progressed);
    if (this.bilingualSubtitles.length > 0) {
      this.createSubtitleList();
      this.setupEventListeners();
    }
  }

  /**
   * 外部更新数据源接口（如：AI 异步分块翻译追加完毕，或者切换了字幕语种）
   * 对面板应用 Diff 增量更新算法以最小化 DOM 操作代价。
   * @param {Array} subtitles 标准双语字幕数组
   */
  setBilingualSubtitles(subtitles, progressed = this.subtitleProgress) {
    this.bilingualSubtitles = subtitles || [];
    this.subtitleProgress = this._normalizeProgress(progressed);
    this._updateSubtitleTabLabel();

    if (this.subtitleListEl) {
      // 若列表面板已处于挂载状态，尝试执行增量 Diff 挂载
      this.updateBilingualSubtitles();
    } else if (this.bilingualSubtitles.length > 0) {
      // 首次挂载
      this.createSubtitleList();
      this.setupEventListeners();
    }
  }

  /**
   * 将外部传入的处理进度规整为 0-100 的整数百分比。
   *
   * @param {number} progressed 字幕处理进度百分比。
   * @returns {number} 可直接展示的进度百分比。
   */
  _normalizeProgress(progressed) {
    const progress = Number(progressed);
    if (!Number.isFinite(progress)) return 0;
    return Math.min(100, Math.max(0, Math.round(progress)));
  }

  _t(key, fallback) {
    return this.i18n(key) || fallback;
  }

  /**
   * 刷新字幕 Tab 标题，在“双语字幕”后显示当前按需断句处理进度。
   *
   * @returns {void}
   */
  _updateSubtitleTabLabel() {
    if (!this.subtitleTabEl) return;
    this.subtitleTabEl.textContent = `${this._t(
      "bilingual_subtitles",
      "双语字幕"
    )} [${this.subtitleProgress}%]`;
  }

  /**
   * 销毁器 - 全面解绑事件监听、注销定时器、强行中断进行中的异步分块渲染并清理 DOM 节点引用以防止内存泄漏
   */
  destroy() {
    this.turnOffAutoSub();
    this._cancelChunkRender();
    this._cancelVirtualRender();
    this._removeEventListeners();
    this._playerResizeObserver?.disconnect();
    this._playerResizeObserver = null;
    window.removeEventListener("resize", this.handleWindowResize);
    this._playerSizeListenerAttached = false;
    this._wordTooltipController?.destroy();
    this._wordTooltipController = null;
    this._favoriteWordsUnsubscribe?.();
    this._favoriteWordsUnsubscribe = null;
    window.removeEventListener("message", this.handleJumpMessage);
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    window.__kissYouTubeSubtitleList = null;
    this.subtitleTabEl = null;
    this.vocabularyTabEl = null;
    this.subtitleListEl = null;
    this.vocabularyListEl = null;
    this.videoSummaryEl = null;
    this.subtitleScrollContainer = null;
    this.subtitleListUl = null;
    this.bilingualSubtitles = [];
    this.rawSubtitleEvents = [];
    this._cachedSubtitleItems = [];
    this._virtualHeights = [];
    this._virtualOffsets = [0];
    this._pendingCenterIndex = -1;
    this._pendingSubtitleTabScrollIndex = -1;
    this.subtitleProgress = 0;
    this.vocabulary = [];
    this._videoSummaryState = "idle";
    this._videoSummaryData = null;
    this._videoSummaryError = "";
    this._videoSummaryRawText = "";
  }

  // ==================================================================================
  // Chunk / Virtual Rendering: 分块渲染兼容入口与虚拟列表工具方法
  // ==================================================================================

  /**
   * 中断正在执行中的空闲分块渲染任务
   */
  _cancelChunkRender() {
    if (this._chunkRenderCancel) {
      this._chunkRenderCancel();
      this._chunkRenderCancel = null;
    }
  }

  /**
   * 利用 requestIdleCallback API（在浏览器主线程空闲期间执行低优先级任务），
   * 对于不支持该 API 的旧版浏览器降级为 setTimeout 零延迟执行。
   */
  _scheduleIdle(callback) {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(callback, { timeout: 100 });
      this._chunkRenderCancel = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(callback, 0);
      this._chunkRenderCancel = () => clearTimeout(id);
    }
  }

  /**
   * 核心渲染优化算法：虚拟化与分块渲染字幕列表。
   *
   * ASR 自动字幕往往拥有数千行数据，如果一次性渲染几千个复杂的 li 节点，会导致浏览器主线程长任务 (Long Task) 爆表，
   * 页面出现明显卡顿甚至失去响应。虚拟化后仅初始化虚拟列表状态，并按需渲染当前视口附近的字幕行，保障了用户交互的平滑顺畅。
   *
   * @param {HTMLUListElement} ul - 字幕列表的 ul 元素
   */
  _renderSubtitlesInChunks(ul) {
    this.subtitleListUl = ul;
    this._resetVirtualMetrics();
    this._scheduleVirtualRender(true);
  }

  /**
   * 重置虚拟列表的高度和窗口缓存。
   * @param {{ preserveHeights?: boolean }} options preserveHeights 为 true 时尽量沿用旧高度，
   * 用于翻译文本增量更新后保持滚动位置稳定；全量重建时则重新回到估算高度。
   */
  _resetVirtualMetrics({ preserveHeights = false } = {}) {
    const previousHeights = preserveHeights ? this._virtualHeights : [];

    this._cachedSubtitleItems = [];
    this._virtualStart = -1;
    this._virtualEnd = -1;
    this._virtualHeights = this.bilingualSubtitles.map(
      (_, index) => previousHeights[index] || this._estimatedItemHeight
    );
    this._rebuildVirtualOffsets();
  }

  /**
   * 根据每行高度缓存重建前缀和偏移表，并同步 ul 的总高度。
   * 虚拟列表只渲染可见 DOM，但滚动条需要完整列表高度来保持原有滚动体验。
   */
  _rebuildVirtualOffsets() {
    const offsets = [0];
    let totalHeight = 0;

    for (let i = 0; i < this._virtualHeights.length; i++) {
      totalHeight += this._virtualHeights[i] || this._estimatedItemHeight;
      offsets.push(totalHeight);
    }

    this._virtualOffsets = offsets;
    if (this.subtitleListUl) {
      this.subtitleListUl.style.height = `${totalHeight + this._virtualTopPadding + this._virtualBottomPadding}px`;
    }
  }

  /**
   * 调度虚拟列表渲染到下一帧执行。
   * 多次滚动或数据更新只保留一个 RAF；force 会在合并后继续保留，确保下一帧跳过窗口相同的短路逻辑。
   * @param {boolean} force 是否强制重建当前可见窗口
   */
  _scheduleVirtualRender(force = false) {
    this._virtualRenderForce = this._virtualRenderForce || force;
    if (this._virtualRenderRaf) return;

    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);

    this._virtualRenderRaf = schedule(() => {
      this._virtualRenderRaf = null;
      const shouldForce = this._virtualRenderForce;
      this._virtualRenderForce = false;
      this._renderVirtualSubtitles(shouldForce);
    });
  }

  /**
   * 取消尚未执行的虚拟渲染任务。
   * 组件销毁或数据源切换时需要清理，防止 RAF 回调在 DOM 被移除后继续访问旧节点。
   */
  _cancelVirtualRender() {
    if (!this._virtualRenderRaf) return;

    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._virtualRenderRaf);
    } else {
      clearTimeout(this._virtualRenderRaf);
    }
    this._virtualRenderRaf = null;
    this._virtualRenderForce = false;
  }

  /**
   * 判断字幕列表当前是否处于可见且可测量状态。
   * 虚拟列表依赖 offsetHeight / clientHeight 计算行高和偏移量；当字幕 Tab 被 display:none 隐藏时，
   * 浏览器会把子树元素的布局尺寸读成 0，此时如果回写高度缓存，会污染后续滚动定位。
   * @returns {boolean} 当前字幕 Tab 是否可以安全执行 DOM 测量和滚动计算
   */
  _isSubtitleTabVisible() {
    return (
      this.activeTab === "subtitles" &&
      this.subtitleListEl &&
      this.subtitleScrollContainer &&
      this.subtitleListEl.style.display !== "none" &&
      this.subtitleListEl.getClientRects().length > 0
    );
  }

  /**
   * 通过偏移表二分查找某个 scrollTop 所在的字幕索引。
   * @param {number} offset 滚动容器内相对虚拟列表顶部的像素偏移
   * @returns {number} 与该偏移最接近的字幕索引；空列表返回 -1
   */
  _findIndexByOffset(offset) {
    const length = this.bilingualSubtitles.length;
    if (length === 0) return -1;

    let left = 0;
    let right = length - 1;
    let best = 0;
    while (left <= right) {
      const mid = (left + right) >> 1;
      if (this._virtualOffsets[mid] <= offset) {
        best = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return Math.min(best, length - 1);
  }

  /**
   * 计算当前滚动视口需要渲染的字幕索引区间。
   * 会在视口上下加入 overscan，保证快速滚动时目标行提前出现在 DOM 中。
   * @returns {{ start: number, end: number }} end 为不包含的结束索引
   */
  _getVirtualRange() {
    const container = this.subtitleScrollContainer;
    const length = this.bilingualSubtitles.length;
    if (!container || length === 0) {
      return { start: 0, end: 0 };
    }

    const viewportTop = Math.max(
      0,
      container.scrollTop - this._virtualTopPadding
    );
    const viewportBottom = viewportTop + container.clientHeight;
    const start = Math.max(
      0,
      this._findIndexByOffset(viewportTop) - this._virtualOverscan
    );
    const end = Math.min(
      length,
      this._findIndexByOffset(viewportBottom) + this._virtualOverscan + 1
    );

    return { start, end };
  }

  /**
   * 根据当前滚动位置重建可见字幕 DOM。
   * @param {boolean} force 为 false 且可见区间未变化时直接返回；为 true 时强制重建以反映数据或高度变化。
   */
  _renderVirtualSubtitles(force = false) {
    if (!this.subtitleListUl || !this.subtitleScrollContainer) return;
    // 隐藏状态下只更新数据源，不重建和测量 DOM，避免 display:none 导致虚拟高度缓存被 0 值覆盖。
    if (!this._isSubtitleTabVisible()) return;

    const { start, end } = this._getVirtualRange();
    if (!force && start === this._virtualStart && end === this._virtualEnd) {
      return;
    }

    this._virtualStart = start;
    this._virtualEnd = end;
    this._cachedSubtitleItems = [];

    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const li = this._createSubtitleListItem(this.bilingualSubtitles[i], i);
      li.style.position = "absolute";
      li.style.left = "0";
      li.style.right = "0";
      li.style.top = `${this._virtualTopPadding + this._virtualOffsets[i]}px`;
      li.style.contain = "layout paint style";

      if (i === this._lastActiveIndex) {
        li.style.opacity = 1;
        li.classList.add("active-subtitle");
      }

      this._cachedSubtitleItems[i] = li;
      fragment.appendChild(li);
    }

    this.subtitleListUl.replaceChildren(fragment);
    this._measureVisibleSubtitleItems();
  }

  /**
   * 测量当前可见字幕行的真实高度，并在高度变化后重建偏移表。
   * 只测量可见行，避免一次性创建/读取全部字幕 DOM；未显示过的行继续使用估算高度。
   */
  _measureVisibleSubtitleItems() {
    // 只在字幕 Tab 可见时测量真实行高；生词本 Tab 下的字幕列表尺寸不可作为布局依据。
    if (!this._isSubtitleTabVisible()) return;

    let changed = false;

    for (let i = this._virtualStart; i < this._virtualEnd; i++) {
      const item = this._cachedSubtitleItems[i];
      if (!item) continue;

      const measuredHeight = item.offsetHeight + this._subtitleItemGap;
      if (
        Number.isFinite(measuredHeight) &&
        Math.abs((this._virtualHeights[i] || 0) - measuredHeight) > 1
      ) {
        this._virtualHeights[i] = measuredHeight;
        changed = true;
      }
    }

    if (!changed) {
      this._pendingCenterIndex = -1;
      return;
    }

    // 仅测量当前可见行；批量测量后统一重建偏移量，
    // 避免渲染完整列表，同时保持自动滚动定位准确。
    this._rebuildVirtualOffsets();

    const pendingCenterIndex = this._pendingCenterIndex;
    this._pendingCenterIndex = -1;
    if (pendingCenterIndex !== -1) {
      // 目标行真实高度已写回后，再按最新偏移补一次居中，
      // 避免跳转后必须等下一次滚动才稳定到列表中间。
      this._scrollIndexIntoView(pendingCenterIndex, {
        stabilizeAfterMeasure: false,
      });
      return;
    }

    this._scheduleVirtualRender(true);
  }

  // ==================================================================================
  // 核心逻辑: 跳转、添加单词与字幕包下载
  // ==================================================================================

  /**
   * 跳转视频到指定的毫秒进度
   * @param {number} timeMs - 视频绝对播放点时间戳（毫秒）
   * @param {number|null} exactIndex 已知目标字幕行索引，避免边界时间点命中上一句字幕
   */
  jumpToTime(timeMs, exactIndex = null) {
    if (this.videoEl && Number.isFinite(timeMs)) {
      this.videoEl.currentTime = timeMs / 1000;
      const targetIndex =
        Number.isInteger(exactIndex) &&
        exactIndex >= 0 &&
        exactIndex < this.bilingualSubtitles.length
          ? exactIndex
          : this._binarySearchSubtitle(timeMs);
      if (targetIndex !== -1) {
        // 跳转触发时立即同步焦点；否则居中会等到下一轮自动滚动轮询。
        const shouldScroll = this.activeTab === "subtitles";
        this._setActiveSubtitle(targetIndex, shouldScroll);
        if (!shouldScroll) {
          // 生词本 Tab 内点击时间戳时，字幕列表不可见，不能立即滚动；
          // 先记录目标索引，等用户切回字幕 Tab 后再居中，否则自动滚动会因 _lastActiveIndex 已更新而直接跳过。
          this._pendingSubtitleTabScrollIndex = targetIndex;
        }
      }

      // 若视频原先为暂停状态，跳转后自动触发播放
      if (this.videoEl.paused) {
        this.videoEl.play();
      }
    }
  }

  _applyFavoriteWords(words, fromSubscription = false) {
    if (fromSubscription) this._favoriteWordsChangedSinceLoad = true;
    this.favoriteWords = words || {};
    const videoId = this._getYouTubeVideoId();
    this.vocabulary = getVideoFavoriteEntries(this.favoriteWords, videoId).map(
      ([, entry]) => ({
        word: entry.word,
        phonetic: entry.phonetic || "",
        definition: entry.definition || "",
        examples: entry.examples || [],
        ...entry.occurrence,
      })
    );
    this._updateVocabularyTabLabel();
    if (this.activeTab === "vocabulary" && this.vocabularyListEl) {
      this._renderVocabulary();
      this._vocabularyDirty = false;
    } else {
      this._vocabularyDirty = true;
    }
  }

  _updateVocabularyTabLabel() {
    if (!this.vocabularyTabEl) return;
    const label = this._t("vocabulary_book", "生词本");
    this.vocabularyTabEl.textContent = this.vocabulary.length
      ? `${label} (${this.vocabulary.length})`
      : label;
  }

  async _toggleFavoriteFromTooltip(wordData) {
    const videoId = this._getYouTubeVideoId();
    if (!videoId) return { saved: false, videoCount: 0 };

    if (hasFavoriteOccurrence(this.favoriteWords, wordData.word, videoId)) {
      return this._removeFavoriteFromTooltip(wordData);
    }

    return this._collectFavoriteFromTooltip(wordData);
  }

  async _collectFavoriteFromTooltip(wordData) {
    const videoId = this._getYouTubeVideoId();
    if (!videoId) return { saved: false, videoCount: 0 };

    const result = await saveFavoriteWord({
      word: wordData.word,
      phonetic: wordData.phonetic,
      definition: wordData.definition,
      examples: wordData.examples,
      occurrence: {
        sourceType: "youtube",
        videoId,
        videoTitle: this._getYouTubeVideoTitle(),
        sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        timestamp: wordData.timestamp ?? 0,
        originalText: wordData.originalText || "",
        translation: wordData.translation || "",
      },
    });
    return { saved: true, videoCount: result.videoCount || 0 };
  }

  async _removeFavoriteFromTooltip(wordData) {
    const videoId = this._getYouTubeVideoId();
    if (!videoId) return { saved: false, videoCount: 0 };
    const result = await removeFavoriteOccurrence(wordData.word, videoId);
    return { saved: false, videoCount: result.videoCount || 0 };
  }

  /**
   * 下载双语字幕为标准的双语对照格式 VTT 文件
   */
  downloadSubtitles() {
    if (!this.bilingualSubtitles || this.bilingualSubtitles.length === 0) {
      logger.info("Youtube Provider: No subtitles to download");
      return;
    }

    try {
      const videoId = this._getYouTubeVideoId() || "video";
      const vttContent = buildBilingualVtt(this.bilingualSubtitles);

      downloadBlobFile(
        vttContent,
        `kiss-subtitles-${videoId}_${Date.now()}.vtt`
      );
    } catch (error) {
      logger.error("Youtube Provider: download subtitles error:", error);
    }
  }

  downloadRawSubtitleEvents() {
    if (!this.rawSubtitleEvents || this.rawSubtitleEvents.length === 0) {
      logger.info("Youtube Provider: No raw subtitle events to download");
      return;
    }

    try {
      const videoId = this._getYouTubeVideoId() || "video";
      const jsonContent = JSON.stringify(this.rawSubtitleEvents, null, 2);

      downloadBlobFile(
        jsonContent,
        `kiss-subtitles-raw-${videoId}_${Date.now()}.json`
      );
    } catch (error) {
      logger.error("Youtube Provider: download raw subtitles error:", error);
    }
  }

  // ==================================================================================
  // UI 渲染与自适应主题逻辑
  // ==================================================================================

  /**
   * 构建面板外框主干并触发字幕/生词初始化渲染流程
   */
  createSubtitleList() {
    if (!this.videoEl) return;

    // 1. 确保侧边栏包裹容器节点存在并自适应挂载
    this._ensureContainer();

    // 2. 如果容器为新建节点，绘制骨架及 Tab 标题栏结构
    if (this.container.children.length === 0) {
      this._renderTabsAndStructure();
    }

    // 3. 强行终止前序分块渲染
    this._cancelChunkRender();

    // 4. 清理上一次的字幕行，从头开始分块异步挂载字幕行
    const ul = this.subtitleListEl.querySelector("ul");
    ul.replaceChildren();
    this._renderSubtitlesInChunks(ul);

    // 5. 渲染生词本列表卡片
    this._renderVocabulary();
  }

  /**
   * 确保挂载主容器，并利用 CSS 变量系统自适应适配 YouTube 原生页面的 Dark/Light 偏好
   */
  _ensureContainer() {
    const existingContainer = document.getElementById(
      "kiss-youtube-subtitle-list-container"
    );
    if (existingContainer && existingContainer !== this.container) {
      existingContainer.remove();
    }

    if (!this.container || !this.container.isConnected) {
      this.container = document.createElement("div");
      this.container.id = "kiss-youtube-subtitle-list-container";
      this.container.className = "notranslate"; // 规避被其他第三方整页翻译插件二次重画
      Object.assign(this.container.style, {
        height: "calc(100vh - 220px)",
        maxHeight: "none",
        zIndex: "999",
        background: "var(--kt-bg, rgba(255, 240, 245, 0.92))",
        backdropFilter: "blur(10px)",
        top: "60px",
        right: "0",
        fontSize: "14px",
        padding: "0",
        border: "var(--kt-border, 1px solid rgba(0, 0, 0, 0.1))",
        borderRadius: "8px",
        minWidth: "320px",
        maxWidth: "600px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: "flex",
        flexDirection: "column",
        marginBottom: "12px",
      });

      // 挂载到右侧推荐流栏的头部
      const secondary = document.getElementById("secondary-inner");
      if (secondary) secondary.prepend(this.container);
    }

    // Inline controls depend on these custom properties. Set a complete
    // fallback synchronously so delayed settings cannot expose browser UI.
    const container = this.container;
    this._applyThemeVars(LIGHT_THEME_VARS);

    // Resolve the user's preferred theme after the safe fallback is visible.
    (async () => {
      try {
        const setting = await getSettingWithDefault();
        const darkMode = setting?.darkMode;
        const prefersDark =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches;
        const isDark =
          darkMode === "dark" || (darkMode === "auto" && prefersDark);
        if (this.container === container && container.isConnected) {
          this._applyThemeVars(isDark ? DARK_THEME_VARS : LIGHT_THEME_VARS);
        }
      } catch (err) {
        logger.info("failed to apply subtitle list theme vars", err);
      }
    })();

    this._syncContainerHeightToPlayer();
    this._observePlayerSize();
  }

  _applyThemeVars(vars) {
    if (!this.container) return;
    Object.entries(vars).forEach(([key, value]) => {
      this.container.style.setProperty(key, value);
    });
  }

  _getPlayerElement() {
    return this.videoEl?.closest(".html5-video-player") || this.videoEl;
  }

  _syncContainerHeightToPlayer() {
    if (!this.container) return;

    const player = this._getPlayerElement();
    const playerHeight = player?.getBoundingClientRect?.().height;
    if (!Number.isFinite(playerHeight) || playerHeight <= 0) return;

    const height = `${Math.round(playerHeight)}px`;
    this.container.style.height = height;
    this.container.style.maxHeight = height;
  }

  _observePlayerSize() {
    const player = this._getPlayerElement();
    if (!player || this._playerSizeListenerAttached) return;

    window.addEventListener("resize", this.handleWindowResize);
    this._playerSizeListenerAttached = true;
    if (typeof ResizeObserver !== "function") return;

    this._playerResizeObserver = new ResizeObserver(() => {
      this._syncContainerHeightToPlayer();
    });
    this._playerResizeObserver.observe(player);
  }

  /**
   * 绘制骨架、关闭按钮以及 Tab 切换卡
   */
  _renderTabsAndStructure() {
    // 1. 创建头部 Tab 区域
    const tabHeader = document.createElement("div");
    tabHeader.style.cssText = `display: flex; border-bottom: 1px solid var(--kt-divider); padding: 0 16px; flex-shrink: 0;`;

    const subtitleTab = document.createElement("button");
    this.subtitleTabEl = subtitleTab;
    this._updateSubtitleTabLabel();
    const vocabularyTab = document.createElement("button");
    this.vocabularyTabEl = vocabularyTab;
    this._updateVocabularyTabLabel();
    const videoSummaryTab = document.createElement("button");
    videoSummaryTab.textContent = this._t("tab_video_summary", "视频总结");

    // 动态控制 Tab 激活态与未激活态 CSS 的映射函数
    const styleTab = (tab, isActive) => {
      tab.style.cssText = `padding: 12px 16px; cursor: pointer; border: none; background: transparent; font-size: 15px; font-weight: ${isActive ? "600" : "500"}; color: ${isActive ? "var(--kt-primary)" : "var(--kt-text)"}; border-bottom: 2px solid ${isActive ? "var(--kt-primary)" : "transparent"}; margin-bottom: -1px; outline: none;`;
    };

    // 关闭侧边列表栏的“×”小按钮
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×"; // 直接使用纯文本的“×”号，不再需要 HTML 转义
    closeBtn.title = this._t("close", "Close");
    closeBtn.style.cssText = `
      margin-left: auto; 
      background: transparent; 
      border: none; 
      color: var(--kt-subtext); 
      font-size: 22px; 
      line-height: 1;
      cursor: pointer; 
      padding: 0 8px;
      display: flex;
      align-items: center;
      transition: color 0.2s;
    `;

    closeBtn.addEventListener("click", () => {
      this.destroy(); // 卸载整个面板
    });

    closeBtn.addEventListener(
      "mouseenter",
      () => (closeBtn.style.color = "var(--kt-text)")
    );
    closeBtn.addEventListener(
      "mouseleave",
      () => (closeBtn.style.color = "var(--kt-subtext)")
    );

    // Tab 内容主容器 (控制 overflow 局部滚动，规避页面全局滚动条抖动)
    const tabContentContainer = document.createElement("div");
    tabContentContainer.style.cssText = `overflow: hidden; flex-grow: 1; display: flex; flex-direction: column; height: calc(100% - 40px);`;

    // ----------------------------------------------------
    // [Tab 1]: 字幕列表面板
    // ----------------------------------------------------
    this.subtitleListEl = document.createElement("div");
    this.subtitleListEl.id = "kiss-youtube-subtitle-list";
    this.subtitleListEl.style.cssText = `display: flex; flex-direction: column; height: 100%; overflow: hidden;`;

    // 字幕操作工具条
    const subActionBar = document.createElement("div");
    subActionBar.style.cssText = `padding: 10px 16px; border-bottom: 1px solid var(--kt-divider); display: flex; justify-content: center; gap: 8px; flex-shrink: 0;`;

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = this._t(
      "download_subtitles_vtt",
      "下载字幕 (VTT)"
    );
    downloadBtn.style.cssText = `padding: 6px 12px; background: var(--kt-btn-bg); color: var(--kt-btn-color); border: var(--kt-btn-border); border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 220ms ease, color 200ms ease, transform 160ms ease;`;

    downloadBtn.addEventListener("mouseenter", () => {
      try {
        const hover = getComputedStyle(this.container).getPropertyValue(
          "--kt-btn-hover-bg"
        );
        if (hover) downloadBtn.style.background = hover;
        downloadBtn.style.transform = "translateY(-1px)";
      } catch (e) {}
    });
    downloadBtn.addEventListener("mouseleave", () => {
      try {
        const normal = getComputedStyle(this.container).getPropertyValue(
          "--kt-btn-bg"
        );
        if (normal) downloadBtn.style.background = normal;
        downloadBtn.style.transform = "translateY(0)";
      } catch (e) {}
    });
    downloadBtn.addEventListener("click", this.downloadSubtitles.bind(this));

    const downloadRawBtn = document.createElement("button");
    downloadRawBtn.textContent = this._t(
      "download_raw_subtitle_events_json",
      "下载源数据 (JSON)"
    );
    downloadRawBtn.style.cssText = `padding: 6px 12px; background: var(--kt-btn-bg); color: var(--kt-btn-color); border: var(--kt-btn-border); border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 220ms ease, color 200ms ease, transform 160ms ease;`;

    downloadRawBtn.addEventListener("mouseenter", () => {
      try {
        const hover = getComputedStyle(this.container).getPropertyValue(
          "--kt-btn-hover-bg"
        );
        if (hover) downloadRawBtn.style.background = hover;
        downloadRawBtn.style.transform = "translateY(-1px)";
      } catch (e) {}
    });
    downloadRawBtn.addEventListener("mouseleave", () => {
      try {
        const normal = getComputedStyle(this.container).getPropertyValue(
          "--kt-btn-bg"
        );
        if (normal) downloadRawBtn.style.background = normal;
        downloadRawBtn.style.transform = "translateY(0)";
      } catch (e) {}
    });
    downloadRawBtn.addEventListener(
      "click",
      this.downloadRawSubtitleEvents.bind(this)
    );

    subActionBar.append(downloadBtn, downloadRawBtn);
    this.subtitleListEl.appendChild(subActionBar);

    // 字幕滚动视口容器
    this.subtitleScrollContainer = document.createElement("div");
    this.subtitleScrollContainer.style.cssText = `overflow-y: auto; flex: 1; padding: 0 16px; position: relative;`;
    this.subtitleScrollContainer.addEventListener(
      "scroll",
      this.handleSubtitleScroll,
      { passive: true }
    );

    const subUl = document.createElement("ul");
    subUl.style.cssText = `list-style-type: none; padding: 0; margin: 0; position: relative;`;
    this.subtitleListUl = subUl;

    this.subtitleScrollContainer.appendChild(subUl);
    this.subtitleListEl.appendChild(this.subtitleScrollContainer);

    // ----------------------------------------------------
    // [Tab 2]: 生词本面板
    // ----------------------------------------------------
    this.vocabularyListEl = document.createElement("div");
    this.vocabularyListEl.id = "kiss-youtube-vocabulary-list";
    this.vocabularyListEl.style.cssText = `display: none; flex-direction: column; height: 100%; overflow: hidden;`;

    // ----------------------------------------------------
    // [Tab 3]: 视频总结面板
    // ----------------------------------------------------
    this.videoSummaryEl = document.createElement("div");
    this.videoSummaryEl.id = "kiss-youtube-video-summary";
    this.videoSummaryEl.style.cssText = `display: none; flex-direction: column; height: 100%; overflow: hidden;`;

    // Tab 点击事件联动
    const allTabs = [subtitleTab, vocabularyTab, videoSummaryTab];
    const allPanels = [
      { el: this.subtitleListEl, key: "subtitles" },
      { el: this.vocabularyListEl, key: "vocabulary" },
      { el: this.videoSummaryEl, key: "video_summary" },
    ];

    const switchTab = (activeKey) => {
      this.activeTab = activeKey;
      allTabs.forEach((tab) => styleTab(tab, false));
      allPanels.forEach(({ el }) => (el.style.display = "none"));

      if (activeKey === "subtitles") {
        styleTab(subtitleTab, true);
        this.subtitleListEl.style.display = "flex";
        if (!this._scrollPendingSubtitleTabIndex()) {
          this._scheduleVirtualRender(true);
        }
      } else if (activeKey === "vocabulary") {
        styleTab(vocabularyTab, true);
        this.vocabularyListEl.style.display = "flex";
        if (this._vocabularyDirty) {
          this._renderVocabulary();
          this._vocabularyDirty = false;
        }
      } else if (activeKey === "video_summary") {
        styleTab(videoSummaryTab, true);
        this.videoSummaryEl.style.display = "flex";
        this._renderVideoSummaryTab();
      }
    };

    subtitleTab.addEventListener("click", () => switchTab("subtitles"));
    vocabularyTab.addEventListener("click", () => switchTab("vocabulary"));
    videoSummaryTab.addEventListener("click", () => switchTab("video_summary"));

    // 缺省激活字幕 Tab（所有 Tab 都需初始化样式，否则会残留浏览器原生 button 外观）
    styleTab(subtitleTab, true);
    styleTab(vocabularyTab, false);
    styleTab(videoSummaryTab, false);

    tabHeader.append(subtitleTab, vocabularyTab, videoSummaryTab, closeBtn);
    tabContentContainer.append(
      this.subtitleListEl,
      this.vocabularyListEl,
      this.videoSummaryEl
    );
    this.container.append(tabHeader, tabContentContainer);
  }

  /**
   * 绘制单行字幕条目并绑定点击跳转进度事件
   *
   * @param {object} sub - 格式化后的字幕条目
   * @param {number} index - 在数组中的序号
   * @returns {HTMLLIElement} 挂载的字幕行 DOM 节点
   */
  _createSubtitleListItem(sub, index) {
    const li = document.createElement("li");
    li.id = `kiss-youtube-item-${index}`;
    li.className = "kiss-youtube-item";
    li.dataset.index = index;
    li.dataset.time = sub.start;
    li.style.cssText = `padding: 12px 16px; border-bottom: 1px solid var(--kt-divider); transition: opacity 0.2s ease; opacity: 0.6; border-radius: 6px; margin-bottom: 4px; display: flex; align-items: flex-start;`;

    // 播放起止时间标签
    const timeSpan = document.createElement("span");
    timeSpan.textContent = `${this.millisToMinutesAndSeconds(sub.start)} `;
    timeSpan.style.cssText = `color: var(--kt-primary); font-weight: 600; margin-right: 10px; font-size: 12px; background: var(--kt-time-bg); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; line-height: 20px; cursor: pointer;`;
    timeSpan.addEventListener("click", (event) => {
      event.stopPropagation();
      this.jumpToTime(sub.start, index);
    });

    const textContainer = document.createElement("div");
    textContainer.style.cssText = `flex-grow: 1;`;

    // 字幕原文
    const textSpan = document.createElement("div");
    textSpan.className = "kiss-youtube-original";
    textSpan.style.cssText = `color: var(--kt-text); font-size: 14px; line-height: 1.4; margin-bottom: 4px;`;
    if (this.enableHoverLookup) {
      textSpan.innerHTML = trustedTypesHelper.createHTML(
        wrapWordsWithSpans(sub.text || "")
      );
      this._wordTooltipController?.attachSpanListeners(
        textSpan,
        () => sub.start,
        () => ({
          originalText: sub.text || "",
          translation: sub.translation || "",
        })
      );
    } else {
      textSpan.textContent = sub.text || "";
    }

    // 字幕译文（在翻译未返回前默认隐藏 display: none）
    const translationEl = document.createElement("div");
    translationEl.className = "kiss-youtube-translation";
    translationEl.textContent = sub.translation || "";
    translationEl.style.display = sub.translation ? "block" : "none";
    translationEl.style.cssText = `color: var(--kt-subtext); font-size: 13px; line-height: 1.4; font-style: italic; min-height: 18px;`;

    li.addEventListener("mouseenter", () => {
      if (!li.classList.contains("active-subtitle")) li.style.opacity = 1;
    });
    li.addEventListener("mouseleave", () => {
      if (!li.classList.contains("active-subtitle")) li.style.opacity = 0.6;
    });

    textContainer.appendChild(textSpan);
    textContainer.appendChild(translationEl);
    li.appendChild(timeSpan);
    li.appendChild(textContainer);
    // 缓存译文节点引用，增量更新当前可见行时避免每次 querySelector。
    li._translationEl = translationEl;

    return li;
  }

  /**
   * 差异增量更新字幕列表：
   * 针对流式加载或 AI 后续批次翻译返回的数据块进行增量更新。
   * 虚拟列表不再直接追加 DOM；这里重置高度/偏移缓存并强制重绘当前窗口，
   * 让新增字幕和翻译后的高度变化统一通过虚拟渲染流程处理，避开低效的全量 DOM 清理重建。
   */
  updateBilingualSubtitles() {
    if (!this.subtitleListEl) return;

    this._resetVirtualMetrics({ preserveHeights: true });
    this._scheduleVirtualRender(true);
  }

  /**
   * 增量局部定向更新某一行字幕的译文内容：
   * 利用二分检索算法 (O(log N)) 在有序的字幕缓存数组中快速定位匹配目标时间轴的 DOM 节点，
   * 随后定向修改译文 textContent 并显示。由于无需重画周边节点，性能极佳。
   *
   * @param {object} subtitleUpdate - 含有 { start, translation } 的更新分片数据
   */
  updateSingleSubtitle(subtitleUpdate) {
    if (!this.subtitleListEl) return;

    const { start, translation } = subtitleUpdate;
    // 对有序的双语字幕数组进行二分精确匹配
    const targetIndex = this._findSubtitleIndexByStart(start);

    if (targetIndex === -1) return;

    // 修改本地缓存数据
    this.bilingualSubtitles[targetIndex].translation = translation;

    // 获取缓存的 li 节点引用进行局部修改，只更新当前可见行；不可见字幕稍后会根据数据源重新渲染。
    const item = this._cachedSubtitleItems[targetIndex];
    if (item) {
      const translationEl =
        item._translationEl || item.querySelector(".kiss-youtube-translation");
      if (translationEl) {
        translationEl.textContent = translation || "";
        translationEl.style.display = translation ? "block" : "none";
        // 译文展示状态会改变行高，调度一次强制渲染以便重新测量可见行。
        this._scheduleVirtualRender(true);
      }
    }
  }

  /**
   * 根据字幕开始时间定位字幕索引。
   * 翻译更新事件只携带 start 时间；字幕数组按 start 升序排列，因此这里用二分查找避免线性扫描。
   * @param {number} start 字幕开始时间（毫秒）
   * @returns {number} 匹配的字幕索引，未找到返回 -1
   */
  _findSubtitleIndexByStart(start) {
    let left = 0;
    let right = this.bilingualSubtitles.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const sub = this.bilingualSubtitles[mid];
      if (sub.start === start) return mid;
      if (sub.start > start) right = mid - 1;
      else left = mid + 1;
    }

    return -1;
  }

  // ==================================================================================
  // 生词本渲染与多格式导出逻辑
  // ==================================================================================

  /**
   * 渲染并构建生词本操作工具栏及生词列表容器
   */
  _renderVocabulary() {
    if (!this.vocabularyListEl) return;

    this.vocabularyListEl.replaceChildren();
    // 导出文件操作按钮区 (导出 JSON, CSV, MD 等)
    const exportContainer = this._createExportContainer();
    // 单词卡片滚动列表容器
    const vocabListContainer = this._createVocabListContainer();

    this.vocabularyListEl.appendChild(exportContainer);
    this.vocabularyListEl.appendChild(vocabListContainer);
  }

  /**
   * 绘制生词导出工具栏
   */
  _createExportContainer() {
    const exportContainer = document.createElement("div");
    exportContainer.style.cssText = `padding: 10px 16px; border-bottom: 1px solid var(--kt-divider); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; gap: 8px;`;

    if (this.vocabulary.length > 0) {
      const count = document.createElement("span");
      count.textContent = `${this.vocabulary.length} ${this._t("vocabulary_count_unit", "个")}`;
      count.style.cssText = `color: var(--kt-subtext); font-size: 12px;`;

      const exportGroup = document.createElement("div");
      exportGroup.style.cssText = `display: flex; align-items: center; gap: 6px;`;
      const formatSelect = document.createElement("select");
      formatSelect.title = this._t("export_format", "导出格式");
      formatSelect.style.cssText = `height: 30px; padding: 0 7px; color: var(--kt-text); background: var(--kt-bg); border: 1px solid var(--kt-divider); border-radius: 4px; font-size: 12px;`;
      ["JSON", "CSV", "TXT", "MD"].forEach((format) => {
        const option = document.createElement("option");
        option.value = format.toLowerCase();
        option.textContent = format;
        formatSelect.appendChild(option);
      });
      const exportBtn = document.createElement("button");
      exportBtn.type = "button";
      exportBtn.textContent = `↓ ${this._t("export", "导出")}`;
      exportBtn.style.cssText = `height: 30px; padding: 0 10px; background: var(--kt-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;`;
      exportBtn.addEventListener("click", () => {
        const handlers = {
          json: this.exportVocabularyAsJson,
          csv: this.exportVocabularyAsCsv,
          txt: this.exportVocabularyAsTxt,
          md: this.exportVocabularyAsMd,
        };
        handlers[formatSelect.value]?.call(this);
      });
      exportGroup.append(formatSelect, exportBtn);
      exportContainer.append(count, exportGroup);
    } else {
      const emptyTip = document.createElement("span");
      emptyTip.textContent = this._t(
        "vocabulary_empty_youtube",
        "暂无生词，可在字幕查词后收藏"
      );
      emptyTip.style.color = "var(--kt-subtext)";
      emptyTip.style.fontSize = "12px";
      exportContainer.appendChild(emptyTip);
    }
    return exportContainer;
  }

  /**
   * 创建生词列表独立滚动容器
   */
  _createVocabListContainer() {
    const container = document.createElement("div");
    container.style.cssText = `overflow-y: auto; overflow-x: hidden; flex: 1; padding: 0 16px; min-height: 0;`;

    const list = document.createElement("div");
    list.style.cssText = `display: flex; flex-direction: column; gap: 16px; padding: 16px 0; width: 100%;`;

    this.vocabulary.forEach((item) => {
      const itemEl = this._createVocabItemElement(item);
      list.appendChild(itemEl);
    });

    container.appendChild(list);
    return container;
  }

  /**
   * 创建单个生词条目的卡片面板
   */
  _createVocabItemElement(item) {
    const vocabItem = document.createElement("div");
    vocabItem.style.cssText = `border-bottom: 1px solid var(--kt-divider); word-wrap: break-word; word-break: break-word;`;

    // 1. 单词与音标以及回放快捷跳转行
    const wordLine = document.createElement("div");
    wordLine.style.cssText = `display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;`;

    const wordEl = document.createElement("div");
    wordEl.textContent = item.word;
    wordEl.style.cssText = `color: var(--kt-text); font-weight: bold; font-size: 16px;`;
    wordLine.appendChild(wordEl);

    if (item.phonetic) {
      const phEl = document.createElement("div");
      const cleanPhonetic = item.phonetic;
      phEl.textContent = `[${cleanPhonetic}]`;
      phEl.style.cssText = `color: var(--kt-subtext); font-style: italic; font-size: 14px;`;
      wordLine.appendChild(phEl);
    }

    if (Number.isFinite(item.timestamp)) {
      // 记录了添加该生词时对应的视频时间戳，支持点击跳转至该处重听，方便磨耳朵记词
      const tsBtn = document.createElement("button");
      tsBtn.textContent = `${this.millisToMinutesAndSeconds(item.timestamp)}`;
      tsBtn.style.cssText = `color: var(--kt-primary); background: none; border: none; padding: 0 4px; font-size: 14px; cursor: pointer;`;
      tsBtn.addEventListener("click", () => this.jumpToTime(item.timestamp));
      wordLine.appendChild(tsBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = this._t(
      "remove_from_video_vocabulary",
      "从本视频生词本移除"
    );
    removeBtn.style.cssText = `margin-left: auto; width: 28px; height: 28px; padding: 0; color: var(--kt-subtext); background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; font-size: 18px; line-height: 1;`;
    removeBtn.addEventListener("click", async () => {
      removeBtn.disabled = true;
      try {
        await removeFavoriteOccurrence(item.word, this._getYouTubeVideoId());
      } catch (error) {
        logger.info("Remove favorite word failed:", error);
        removeBtn.disabled = false;
      }
    });
    wordLine.appendChild(removeBtn);
    vocabItem.appendChild(wordLine);

    // 2. 词典中文释义
    if (item.definition) {
      const defEl = document.createElement("div");
      defEl.textContent = item.definition;
      defEl.style.cssText = `color: var(--kt-text); margin: 8px 0; font-size: 14px; line-height: 1.4;`;
      vocabItem.appendChild(defEl);
    }

    if (item.originalText) {
      const contextEl = document.createElement("div");
      contextEl.style.cssText = `margin: 10px 0; padding-left: 10px; border-left: 2px solid var(--kt-primary); color: var(--kt-text); font-size: 13px; line-height: 1.5;`;
      const originalEl = document.createElement("div");
      originalEl.textContent = item.originalText;
      contextEl.appendChild(originalEl);
      if (item.translation) {
        const translationEl = document.createElement("div");
        translationEl.textContent = item.translation;
        translationEl.style.cssText = `margin-top: 3px; color: var(--kt-subtext);`;
        contextEl.appendChild(translationEl);
      }
      vocabItem.appendChild(contextEl);
    }

    // 3. 例句展示
    if (item.examples && item.examples.length > 0) {
      const exContainer = document.createElement("div");
      exContainer.style.cssText = `color: var(--kt-subtext); font-size: 13px; line-height: 1.4;`;
      item.examples.forEach((ex) => {
        const exItem = document.createElement("div");
        exItem.style.marginBottom = "8px";
        const eng = document.createElement("div");
        eng.textContent = ex.eng;
        exItem.appendChild(eng);
        if (ex.chs) {
          const chs = document.createElement("div");
          chs.textContent = ex.chs;
          chs.style.cssText = `color: var(--kt-subtext); font-style: italic;`;
          exItem.appendChild(chs);
        }
        exContainer.appendChild(exItem);
      });
      vocabItem.appendChild(exContainer);
    }

    return vocabItem;
  }

  // ----------------------------------------------------
  // 生词本数据导出实现
  // ----------------------------------------------------

  // 导出为结构化 JSON 格式
  exportVocabularyAsJson() {
    if (this.vocabulary.length === 0) return;
    const videoId = this._getYouTubeVideoId();

    const processedVocabulary = this.vocabulary.map((item) => {
      const newItem = { ...item };
      // 导出前对音标进行格式标准化（统一包裹方括号）
      if (item.phonetic) {
        const cleanPhonetic = item.phonetic;
        newItem.phonetic = cleanPhonetic ? `[${cleanPhonetic}]` : "";
      }
      return newItem;
    });

    const exportData = {
      videoInfo: {
        title: this._getYouTubeVideoTitle(),
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
        exportTime: new Date().toISOString(),
      },
      vocabulary: processedVocabulary,
    };

    this._downloadFile(
      JSON.stringify(exportData, null, 2),
      "application/json",
      "json"
    );
  }

  // 导出为 CSV 表格数据格式
  exportVocabularyAsCsv() {
    if (this.vocabulary.length === 0) return;
    const videoId = this._getYouTubeVideoId();
    const header =
      "Word,Phonetic,Definition,Original Context,Context Translation,Example1,Translation1,Example2,Translation2,Video Link";

    const rows = this.vocabulary.map((item) => {
      const escapeCSVField = (field) => {
        if (!field) return '""';
        // 对双引号进行转义，确保 CSV 规范解析
        return `"${field.toString().replace(/"/g, '""')}"`;
      };

      const cleanPhonetic = item.phonetic;
      const phonetic = cleanPhonetic ? `[${cleanPhonetic}]` : "";
      const ex1 = item.examples?.[0];
      const ex2 = item.examples?.[1];

      let videoLink = "";
      if (Number.isFinite(item.timestamp) && videoId) {
        // 拼接带秒数参数 (t=xx) 的 YouTube 回放进度链接
        videoLink = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(item.timestamp / 1000)}s`;
      }

      return [
        item.word,
        phonetic,
        item.definition,
        item.originalText,
        item.translation,
        ex1?.eng || "",
        ex1?.chs || "",
        ex2?.eng || "",
        ex2?.chs || "",
        videoLink,
      ]
        .map(escapeCSVField)
        .join(",");
    });

    // 关键修正：在 CSV 文本头部硬性追加 UTF-8 BOM 字符 "\uFEFF"，
    // 使得导出的中文 CSV 文件在 Windows 版 Microsoft Excel 双击直接打开时能够被正确识别编码，彻底告别乱码。
    const csvContent = [
      `"${this._getYouTubeVideoTitle()}",,,,,,,,,`,
      `"${videoId ? `https://www.youtube.com/watch?v=${videoId}` : "生词本"}",,,,,,,,,`,
      `,,,,,,,,,,`,
      header,
      ...rows,
    ].join("\n");

    this._downloadFile("\uFEFF" + csvContent, "text/csv;charset=utf-8;", "csv");
  }

  // 导出为 Plain Text 纯文本排版格式
  exportVocabularyAsTxt() {
    if (this.vocabulary.length === 0) return;
    const videoId = this._getYouTubeVideoId();
    const lines = [];

    lines.push("生词本导出文件");
    lines.push(`视频标题: ${this._getYouTubeVideoTitle()}`);
    if (videoId)
      lines.push(`视频链接: https://www.youtube.com/watch?v=${videoId}`);
    lines.push(`导出时间: ${new Date().toLocaleString("zh-CN")}`);
    lines.push("");

    this.vocabulary.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.word}`);
      const cleanPhonetic = item.phonetic;
      if (cleanPhonetic) lines.push(`   音标: [${cleanPhonetic}]`);
      if (item.definition) lines.push(`   释义: ${item.definition}`);
      if (item.originalText) lines.push(`   原句: ${item.originalText}`);
      if (item.translation) lines.push(`   译文: ${item.translation}`);

      if (item.examples && item.examples.length > 0) {
        lines.push("   例句:");
        item.examples.slice(0, 2).forEach((ex, i) => {
          lines.push(`   ${i + 1}. ${ex.eng}`);
          if (ex.chs) lines.push(`      ${ex.chs}`);
        });
      }
      if (Number.isFinite(item.timestamp) && videoId) {
        lines.push(
          `   视频链接: https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(item.timestamp / 1000)}s`
        );
      }
      lines.push("");
    });

    this._downloadFile(lines.join("\n"), "text/plain;charset=utf-8;", "txt");
  }

  // 导出为美观的 Markdown 格式文档
  exportVocabularyAsMd() {
    if (this.vocabulary.length === 0) return;
    const videoId = this._getYouTubeVideoId();
    const videoLink = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : "";

    const lines = [];
    lines.push("# 生词本导出文件");
    lines.push(`**视频标题:** ${this._getYouTubeVideoTitle()}`);
    if (videoLink) lines.push(`**视频链接:** [${videoLink}](${videoLink})`);
    lines.push(`**导出时间:** ${new Date().toLocaleString("zh-CN")}`);
    lines.push("");

    this.vocabulary.forEach((item, index) => {
      lines.push(`${index + 1}. **${item.word}**`);
      const cleanPhonetic = item.phonetic;
      if (cleanPhonetic) lines.push(`   *音标 Phonetic:* [${cleanPhonetic}]`);
      if (item.definition)
        lines.push(`   *释义 Definition:* ${item.definition}`);
      if (item.originalText)
        lines.push(`   *原句 Context:* ${item.originalText}`);
      if (item.translation)
        lines.push(`   *译文 Translation:* ${item.translation}`);

      if (item.examples && item.examples.length > 0) {
        lines.push("   *例句 Examples:*");
        item.examples.slice(0, 2).forEach((ex, i) => {
          lines.push(`   ${i + 1}. ${ex.eng}`);
          if (ex.chs) lines.push(`      ${ex.chs}`);
        });
      }
      if (Number.isFinite(item.timestamp) && videoId) {
        const link = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(item.timestamp / 1000)}s`;
        lines.push(`   *视频链接 Video Link:* [跳转到视频时间点](${link})`);
      }
      lines.push("");
    });

    this._downloadFile(lines.join("\n"), "text/markdown;charset=utf-8;", "md");
  }

  // ==================================================================================
  // 视频总结渲染与交互逻辑
  // ==================================================================================

  /**
   * 渲染视频总结 Tab 内容。
   * 根据当前状态（idle/loading/success/error）显示不同的 UI。
   */
  _renderVideoSummaryTab() {
    if (!this.videoSummaryEl) return;

    this.videoSummaryEl.replaceChildren();

    // 顶部操作区
    const actionBar = document.createElement("div");
    actionBar.style.cssText = `padding: 10px 16px; border-bottom: 1px solid var(--kt-divider); display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;

    const generateBtn = document.createElement("button");
    generateBtn.textContent = `▶ ${this._t("video_summary_generate", "生成视频总结")}`;
    generateBtn.disabled = this._videoSummaryState === "loading";
    generateBtn.style.cssText = `padding: 6px 12px; background: var(--kt-btn-bg); color: var(--kt-btn-color); border: var(--kt-btn-border); border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 220ms ease, transform 160ms ease; opacity: ${this._videoSummaryState === "loading" ? "0.6" : "1"};`;

    generateBtn.addEventListener("mouseenter", () => {
      if (this._videoSummaryState !== "loading") {
        try {
          const hover = getComputedStyle(this.container).getPropertyValue(
            "--kt-btn-hover-bg"
          );
          if (hover) generateBtn.style.background = hover;
          generateBtn.style.transform = "translateY(-1px)";
        } catch (e) {}
      }
    });
    generateBtn.addEventListener("mouseleave", () => {
      try {
        const normal = getComputedStyle(this.container).getPropertyValue(
          "--kt-btn-bg"
        );
        if (normal) generateBtn.style.background = normal;
        generateBtn.style.transform = "translateY(0)";
      } catch (e) {}
    });
    generateBtn.addEventListener("click", () =>
      this._handleGenerateVideoSummary()
    );

    actionBar.appendChild(generateBtn);
    this.videoSummaryEl.appendChild(actionBar);

    // 内容区域（可滚动）
    const contentArea = document.createElement("div");
    contentArea.style.cssText = `overflow-y: auto; flex: 1; padding: 12px 16px;`;

    if (this._videoSummaryState === "loading") {
      // 加载状态
      const loadingContainer = document.createElement("div");
      loadingContainer.style.cssText = `display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; gap: 12px;`;

      const progressBar = document.createElement("div");
      progressBar.style.cssText = `width: 80%; height: 4px; background: var(--kt-divider); border-radius: 2px; overflow: hidden;`;
      const progressInner = document.createElement("div");
      progressInner.style.cssText = `width: 30%; height: 100%; background: var(--kt-primary); border-radius: 2px; animation: kiss-progress 1.5s ease-in-out infinite;`;
      progressBar.appendChild(progressInner);

      const loadingText = document.createElement("div");
      loadingText.textContent = this._t(
        "video_summary_loading",
        "正在分析视频内容..."
      );
      loadingText.style.cssText = `color: var(--kt-subtext); font-size: 13px;`;

      loadingContainer.appendChild(progressBar);
      loadingContainer.appendChild(loadingText);
      contentArea.appendChild(loadingContainer);
    } else if (this._videoSummaryState === "error") {
      // 错误状态
      const errorContainer = document.createElement("div");
      errorContainer.style.cssText = `display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; gap: 12px;`;

      const errorText = document.createElement("div");
      errorText.textContent =
        this._videoSummaryError ||
        this._t("video_summary_error", "生成视频总结失败");
      errorText.style.cssText = `color: #e57373; font-size: 13px; text-align: center;`;

      const retryBtn = document.createElement("button");
      retryBtn.textContent = this._t("video_summary_retry", "重试");
      retryBtn.style.cssText = `padding: 6px 16px; background: var(--kt-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;`;
      retryBtn.addEventListener("click", () =>
        this._handleGenerateVideoSummary()
      );

      errorContainer.appendChild(errorText);
      errorContainer.appendChild(retryBtn);
      contentArea.appendChild(errorContainer);
    } else if (
      this._videoSummaryState === "success" &&
      this._videoSummaryData
    ) {
      // 成功状态：展示总结内容
      this._renderVideoSummaryContent(contentArea, this._videoSummaryData);
    } else {
      // 空闲状态：提示用户
      const idleContainer = document.createElement("div");
      idleContainer.style.cssText = `display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0; gap: 12px;`;

      const subtitleCount = this.bilingualSubtitles?.length || 0;
      if (subtitleCount === 0) {
        const noSubtitlesText = document.createElement("div");
        noSubtitlesText.textContent = this._t(
          "video_summary_no_subtitles",
          "暂无字幕数据，请先开启双语字幕。"
        );
        noSubtitlesText.style.cssText = `color: var(--kt-subtext); font-size: 13px; text-align: center;`;
        idleContainer.appendChild(noSubtitlesText);
      } else {
        const readyText = document.createElement("div");
        readyText.textContent = `已加载 ${subtitleCount} 条字幕，点击上方按钮生成视频总结。`;
        readyText.style.cssText = `color: var(--kt-subtext); font-size: 13px; text-align: center;`;
        idleContainer.appendChild(readyText);
      }

      contentArea.appendChild(idleContainer);
    }

    this.videoSummaryEl.appendChild(contentArea);
  }

  /**
   * 渲染视频总结内容（成功后展示）
   * @param {HTMLElement} container 内容容器
   * @param {Object} data 解析后的总结数据
   */
  _renderVideoSummaryContent(container, data) {
    const { mainPoints, sections, highlights, rawText } = data;

    // 如果没有解析出结构化数据，显示原始文本
    if (!mainPoints?.length && !sections?.length && !highlights?.length) {
      const rawContent = document.createElement("div");
      rawContent.style.cssText = `color: var(--kt-text); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;`;
      rawContent.textContent = rawText || "";
      container.appendChild(rawContent);
      return;
    }

    // 主要观点
    if (mainPoints && mainPoints.length > 0) {
      const section = document.createElement("div");
      section.style.cssText = `margin-bottom: 16px;`;

      const title = document.createElement("div");
      title.textContent = this._t("video_summary_main_points", "主要观点");
      title.style.cssText = `color: var(--kt-text); font-size: 15px; font-weight: 600; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--kt-divider);`;
      section.appendChild(title);

      const list = document.createElement("ul");
      list.style.cssText = `margin: 0; padding-left: 20px;`;
      mainPoints.forEach((point) => {
        const li = document.createElement("li");
        li.textContent = point;
        li.style.cssText = `color: var(--kt-text); font-size: 13px; line-height: 1.5; margin-bottom: 4px;`;
        list.appendChild(li);
      });
      section.appendChild(list);
      container.appendChild(section);
    }

    // 分段详情
    if (sections && sections.length > 0) {
      const section = document.createElement("div");
      section.style.cssText = `margin-bottom: 16px;`;

      const title = document.createElement("div");
      title.textContent = this._t("video_summary_sections", "分段详情");
      title.style.cssText = `color: var(--kt-text); font-size: 15px; font-weight: 600; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--kt-divider);`;
      section.appendChild(title);

      sections.forEach((sec) => {
        const sectionCard = document.createElement("div");
        sectionCard.style.cssText = `margin-bottom: 12px; padding: 8px 12px; background: var(--kt-time-bg); border-radius: 6px;`;

        // 分段标题 + 时间范围
        const header = document.createElement("div");
        header.style.cssText = `display: flex; align-items: center; gap: 8px; margin-bottom: 6px;`;

        const sectionTitle = document.createElement("span");
        sectionTitle.textContent = sec.title;
        sectionTitle.style.cssText = `color: var(--kt-text); font-size: 13px; font-weight: 600;`;
        header.appendChild(sectionTitle);

        if (sec.startTime != null) {
          const timeBtn = document.createElement("button");
          timeBtn.textContent = this.millisToMinutesAndSeconds(sec.startTime);
          timeBtn.style.cssText = `color: var(--kt-primary); background: none; border: none; padding: 0 4px; font-size: 12px; cursor: pointer;`;
          timeBtn.addEventListener("click", () =>
            this.jumpToTime(sec.startTime)
          );
          header.appendChild(timeBtn);
        }

        sectionCard.appendChild(header);

        // 分段内容要点
        if (sec.content && sec.content.length > 0) {
          const pointList = document.createElement("ul");
          pointList.style.cssText = `margin: 0; padding-left: 16px;`;
          sec.content.forEach((point) => {
            const li = document.createElement("li");
            li.textContent = point;
            li.style.cssText = `color: var(--kt-text); font-size: 12px; line-height: 1.5; margin-bottom: 2px;`;
            pointList.appendChild(li);
          });
          sectionCard.appendChild(pointList);
        }

        section.appendChild(sectionCard);
      });

      container.appendChild(section);
    }

    // 精彩亮点
    if (highlights && highlights.length > 0) {
      const section = document.createElement("div");
      section.style.cssText = `margin-bottom: 16px;`;

      const title = document.createElement("div");
      title.textContent = this._t("video_summary_highlights", "精彩亮点");
      title.style.cssText = `color: var(--kt-text); font-size: 15px; font-weight: 600; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--kt-divider);`;
      section.appendChild(title);

      highlights.forEach((highlight) => {
        const quote = document.createElement("div");
        quote.style.cssText = `padding: 6px 12px; margin-bottom: 6px; border-left: 3px solid var(--kt-primary); background: var(--kt-time-bg); border-radius: 0 4px 4px 0; color: var(--kt-text); font-size: 12px; line-height: 1.5;`;
        quote.textContent = highlight;
        section.appendChild(quote);
      });

      container.appendChild(section);
    }
  }

  /**
   * 处理生成视频总结的按钮点击事件
   */
  async _handleGenerateVideoSummary() {
    // 检查是否有字幕数据
    const subtitles = collectSubtitleData();
    if (!subtitles || subtitles.length === 0) {
      this._videoSummaryState = "error";
      this._videoSummaryError = this._t(
        "video_summary_no_subtitles",
        "暂无字幕数据，请先开启双语字幕。"
      );
      this._renderVideoSummaryTab();
      return;
    }

    // 切换到加载状态
    this._videoSummaryState = "loading";
    this._videoSummaryData = null;
    this._videoSummaryError = "";
    this._renderVideoSummaryTab();

    try {
      // 格式化字幕数据
      const formattedSubs = formatSubtitlesForPrompt(subtitles);

      // 请求后台生成总结
      const result = await requestVideoSummary(formattedSubs);

      if (result?.error) {
        this._videoSummaryState = "error";
        this._videoSummaryError = result.error;
      } else if (result?.summary) {
        this._videoSummaryRawText = result.summary;
        this._videoSummaryData = parseVideoSummaryResponse(result.summary);
        this._videoSummaryState = "success";
      } else {
        this._videoSummaryState = "error";
        this._videoSummaryError = this._t(
          "video_summary_error",
          "生成视频总结失败"
        );
      }
    } catch (err) {
      logger.error("Video summary error:", err);
      this._videoSummaryState = "error";
      this._videoSummaryError =
        err?.message || this._t("video_summary_error", "生成视频总结失败");
    }

    this._renderVideoSummaryTab();
  }

  // ==================================================================================
  // 字幕同步滚动核心算法
  // ==================================================================================

  /**
   * 绑定各种控制自动滚屏的交互监听器
   */
  setupEventListeners() {
    if (!this.container || !this.videoEl) return;
    if (this._eventListenersAttached) return;

    // 鼠标悬浮于侧边字幕面板时停止自动随视频播放滚动，方便用户进行鼠标选词或手动滑动浏览，鼠标移出时恢复自动滚动高亮，提升用户体验
    this.container.addEventListener(
      "mouseenter",
      this.handleContainerMouseEnter
    );
    this.container.addEventListener(
      "mouseleave",
      this.handleContainerMouseLeave
    );

    // 视频事件联动：视频结束或暂停时停止定时器，视频开始播放时开启同步定时器
    this.videoEl.addEventListener("ended", this.handleVideoEnded);
    this.videoEl.addEventListener("pause", this.handleVideoPause);
    this.videoEl.addEventListener("play", this.handleVideoPlay);
    this._eventListenersAttached = true;
  }

  /**
   * 解绑当前实例挂载的所有 DOM / video 事件。
   * 与 setupEventListeners 中的具名 handler 一一对应，确保切换视频或销毁侧栏时不会重复监听。
   */
  _removeEventListeners() {
    if (this.subtitleScrollContainer) {
      this.subtitleScrollContainer.removeEventListener(
        "scroll",
        this.handleSubtitleScroll
      );
    }

    if (this.container) {
      this.container.removeEventListener(
        "mouseenter",
        this.handleContainerMouseEnter
      );
      this.container.removeEventListener(
        "mouseleave",
        this.handleContainerMouseLeave
      );
    }

    if (this.videoEl) {
      this.videoEl.removeEventListener("ended", this.handleVideoEnded);
      this.videoEl.removeEventListener("pause", this.handleVideoPause);
      this.videoEl.removeEventListener("play", this.handleVideoPlay);
    }

    this._eventListenersAttached = false;
  }

  /**
   * 启动以 200ms 为精度的自动同步滚动定时轮询。
   */
  turnOnAutoSub() {
    this.turnOffAutoSub();
    if (this.videoEl.paused) return; // 暂停状态无需轮询

    this.loopAutoScroll = setInterval(() => {
      if (
        !this.videoEl ||
        this.activeTab !== "subtitles" ||
        this.bilingualSubtitles.length === 0
      )
        return;

      const currentTimeMs = this.videoEl.currentTime * 1000;
      // 利用 O(log N) 二分法算出当前播放时间处于哪一条字幕行
      let currentIndex = this._binarySearchSubtitle(currentTimeMs);

      // 缓存对比：若当前行索引并未发生变动，直接返回，避免无谓的 DOM 改写与滚动行为
      if (this._lastActiveIndex === currentIndex) return;

      this._setActiveSubtitle(currentIndex, true);
    }, 200);
  }

  /**
   * 更新当前高亮字幕索引，并按需将目标行滚动到可见区域中间。
   * 虚拟列表中目标 DOM 可能尚未渲染，因此滚动使用偏移缓存而不是直接依赖 DOM 节点。
   * @param {number} index 需要高亮的字幕索引
   * @param {boolean} shouldScroll 是否同步滚动到目标行
   */
  _setActiveSubtitle(index, shouldScroll = false) {
    const previousIndex = this._lastActiveIndex;
    this._lastActiveIndex = index;

    this._updateSubtitleItemActive(previousIndex, false);
    this._updateSubtitleItemActive(index, true);

    if (shouldScroll && index !== -1) {
      this._scrollIndexIntoView(index);
    }
  }

  /**
   * 更新某个可见字幕 DOM 的高亮状态。
   * 离屏行没有对应 DOM，稍后进入虚拟窗口时会在 _renderVirtualSubtitles 中根据 _lastActiveIndex 恢复状态。
   * @param {number} index 字幕索引
   * @param {boolean} isActive 是否设置为高亮状态
   */
  _updateSubtitleItemActive(index, isActive) {
    if (index === -1) return;

    const item = this._cachedSubtitleItems[index];
    if (!item) return;

    item.style.opacity = isActive ? 1 : 0.6;
    item.classList.toggle("active-subtitle", isActive);
  }

  /**
   * 消费隐藏字幕 Tab 期间记录的待滚动目标。
   * @returns {boolean} 是否成功处理了待滚动目标；返回 false 时调用方可执行普通虚拟窗口刷新。
   */
  _scrollPendingSubtitleTabIndex() {
    const index = this._pendingSubtitleTabScrollIndex;
    if (index === -1 || !this._isSubtitleTabVisible()) return false;

    // 只有确认字幕 Tab 已经恢复布局后才消费 pending，避免刚切换时布局尚未完成导致目标索引丢失。
    this._pendingSubtitleTabScrollIndex = -1;
    this._scrollIndexIntoView(index);
    return true;
  }

  /**
   * 根据虚拟偏移缓存把指定字幕行滚动到容器中间。
   * 如果目标行刚被渲染且真实高度发生变化，会通过 _pendingCenterIndex 在测量后再补一次居中。
   * @param {number} index 目标字幕索引
   * @param {{ stabilizeAfterMeasure?: boolean }} options 是否在测量后补偿一次居中
   */
  _scrollIndexIntoView(index, { stabilizeAfterMeasure = true } = {}) {
    const container = this.subtitleScrollContainer;
    if (!container || index < 0 || index >= this.bilingualSubtitles.length) {
      return;
    }

    if (!this._isSubtitleTabVisible()) {
      // 外部消息或生词本时间戳可能在字幕 Tab 隐藏时触发跳转；
      // 此时保存目标行，等列表可见后再用真实容器高度计算居中位置。
      this._pendingSubtitleTabScrollIndex = index;
      return;
    }

    if (stabilizeAfterMeasure) {
      this._pendingCenterIndex = index;
    }

    const itemTop = this._virtualTopPadding + this._virtualOffsets[index];
    const itemHeight = this._virtualHeights[index] || this._estimatedItemHeight;
    const targetTop = itemTop - container.clientHeight / 2 + itemHeight / 2;

    container.scrollTop = Math.max(0, targetTop);
    this._scheduleVirtualRender(true);
  }

  /**
   * 二分查找：在有序的双语字幕数组中，以 O(log N) 复杂度快速搜寻时间点 timeMs 对应的字幕块
   */
  _binarySearchSubtitle(timeMs) {
    let left = 0;
    let right = this.bilingualSubtitles.length - 1;
    let bestMatch = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const sub = this.bilingualSubtitles[mid];

      const isLastSubtitle = mid === this.bilingualSubtitles.length - 1;
      if (timeMs >= sub.start && (timeMs < sub.end || isLastSubtitle)) {
        return mid; // 精确匹配该时间范围
      } else if (timeMs < sub.start) {
        right = mid - 1;
      } else {
        left = mid + 1;
        bestMatch = mid; // 若没有精确包含在此区间内，将最接近的前一个字幕索引存入 bestMatch 作为缺省候选项
      }
    }
    return bestMatch;
  }

  // 关闭同步滚动定时器
  turnOffAutoSub() {
    if (this.loopAutoScroll) {
      clearInterval(this.loopAutoScroll);
      this.loopAutoScroll = null;
    }
  }

  // ==================================================================================
  // Helpers: 工具函数
  // ==================================================================================

  /**
   * 将字符串文本转换成 Blob 文件并唤起浏览器下载弹窗
   */
  _downloadFile(content, mimeType, extension) {
    const blob = new Blob([content], { type: mimeType });
    downloadBlobFile(
      blob,
      `kiss-vocabulary-${new Date().toISOString().slice(0, 10)}.${extension}`
    );
  }

  /** 格式化时间戳（毫秒）为 MM:SS。 */
  millisToMinutesAndSeconds(millis) {
    if (!Number.isFinite(millis)) return "0:00";
    const minutes = Math.floor(millis / 60000);
    const seconds = Math.floor((millis % 60000) / 1000);
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  // 截取当前 YouTube 的 URL 获取当前播放视频的 ID
  _getYouTubeVideoId() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get("v");
    } catch (e) {
      return null;
    }
  }

  // 获取视频标题 DOM 中的文本内容
  _getYouTubeVideoTitle() {
    try {
      const titleElement = document.querySelector("h1 yt-formatted-string");
      return titleElement ? titleElement.textContent : "YouTube Video";
    } catch (e) {
      return "YouTube Video";
    }
  }
}
