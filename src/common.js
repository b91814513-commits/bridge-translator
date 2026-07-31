import { OPT_HIGHLIGHT_WORDS_DISABLE } from "./config";
import {
  getFabWithDefault,
  getSettingWithDefault,
  getWordsWithDefault,
} from "./libs/storage";
import { isIframe } from "./libs/iframe";
import { genEventName } from "./libs/utils";
import { handlePing, injectScript } from "./libs/gm";
import { matchRule } from "./libs/rules";
import { trySyncAllSubRules } from "./libs/subRules";
import { isInBlacklist } from "./libs/blacklist";
import { runSubtitle } from "./subtitle/subtitle";
import { logger } from "./libs/log";
import { injectInlineJs } from "./libs/injector";
import TranslatorManager from "./libs/translatorManager";
import { extractPageContent, requestWebSummary } from "./libs/webSummary";
import { showSummaryPopup, hideSummaryPopup } from "./views/Summary";
import { BRIDGE_SUMMARIZE_TRIGGER } from "./config/msg";
import { newI18n } from "./config/i18n";
import { browser, isContextInvalidatedError } from "./libs/browser";

/**
 * 油猴脚本特权桥接设置。
 * 当用户在浏览器中打开插件设置页时（打包后的 options.html 或是 dev 调试页面），
 * 该函数负责把油猴特权 GM 接口暴露给页面环境，以便设置页面能直接读写油猴配置项。
 */
function runSettingPage() {
  // 若油猴实际提供了 unsafeWindow (直通宿主 window 权限)，则直接挂载
  if (hasUnsafeWindowBridge()) {
    unsafeWindow.GM = GM;
    unsafeWindow.APP_INFO = {
      name: process.env.REACT_APP_NAME,
      version: process.env.REACT_APP_VERSION,
    };
  } else {
    // 否则，回退到注册 CustomEvent 监听器进行间接通信代理
    const ping = genEventName();
    window.addEventListener(ping, handlePing);
    injectInlineJs(
      `(${injectScript})("${ping}")`,
      "bridge-translator-options-injector"
    );
  }
}

function hasUnsafeWindowBridge() {
  return typeof unsafeWindow !== "undefined";
}

/**
 * 检查指定的 URL 是否属于扩展/脚本的设置页面。
 * 用于匹配本地开发、打包产物及外置挂载的不同设置页路由。
 * @param {string} href 需要检测的当前页面完整 URL
 * @returns {boolean} 若当前处于设置页面则返回 true
 */
function isOptionsPageHref(href) {
  return [
    process.env.REACT_APP_OPTIONSPAGE,
    process.env.REACT_APP_OPTIONSPAGE_DEV,
    process.env.REACT_APP_OPTIONSPAGE_DEV2,
    process.env.REACT_APP_OPTIONSPAGE_LOCAL,
  ]
    .filter(Boolean)
    .some((optionsPage) => href.startsWith(optionsPage));
}

/**
 * 建立旧式 GM_* API 到现代 GM 对象的兼容垫片。
 * 必须在任何 storage 访问前执行，避免旧油猴环境在数据迁移阶段缺少 GM。
 */
function ensureUserscriptGM() {
  globalThis.GM = globalThis.GM || {};

  globalThis.GM.xmlHttpRequest =
    globalThis.GM.xmlHttpRequest || globalThis.GM_xmlhttpRequest;
  globalThis.GM.registerMenuCommand =
    globalThis.GM.registerMenuCommand || globalThis.GM_registerMenuCommand;
  globalThis.GM.unregisterMenuCommand =
    globalThis.GM.unregisterMenuCommand || globalThis.GM_unregisterMenuCommand;
  globalThis.GM.setValue = globalThis.GM.setValue || globalThis.GM_setValue;
  globalThis.GM.getValue = globalThis.GM.getValue || globalThis.GM_getValue;
  globalThis.GM.deleteValue =
    globalThis.GM.deleteValue || globalThis.GM_deleteValue;
  globalThis.GM.info = globalThis.GM.info || globalThis.GM_info;
}

/**
 * 在页面顶部弹出一个悬浮的红色错误提示 Banner 框，持续 10 秒后自动淡出。
 * @param {string} message 错误内容信息
 */
function showErr(message) {
  // body 尚未就绪时（早期注入、特殊页面）直接跳过，避免 appendChild 抛出新的空引用异常
  if (!document.body) return;

  const bannerId = "Bridge-Translator-Message";
  const existingBanner = document.getElementById(bannerId);
  if (existingBanner) {
    existingBanner.remove();
  }

  const banner = document.createElement("div");
  banner.id = bannerId;

  // 设置 Banner 绝对定位和高 z-index，保证提示在前台可见
  Object.assign(banner.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    backgroundColor: "#f44336",
    color: "white",
    textAlign: "center",
    padding: "8px 16px",
    zIndex: "1001",
    boxSizing: "border-box",
    fontSize: "16px",
    boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
  });

  const closeButton = document.createElement("span");
  closeButton.textContent = "×";

  Object.assign(closeButton.style, {
    position: "absolute",
    top: "50%",
    right: "20px",
    transform: "translateY(-50%)",
    cursor: "pointer",
    fontSize: "22px",
    fontWeight: "bold",
  });

  const messageText = document.createTextNode(`Bridge-Translator: ${message}`);
  banner.appendChild(messageText);
  banner.appendChild(closeButton);

  document.body.appendChild(banner);

  // 渐隐淡出效果
  const removeBanner = () => {
    banner.style.transition = "opacity 0.5s ease";
    banner.style.opacity = "0";
    setTimeout(() => {
      if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    }, 500);
  };

  closeButton.onclick = removeBanner;
  setTimeout(removeBanner, 10000); // 10秒后自动消失
}

/**
 * 依据匹配规则，获取用户生词本中的所有单词用于高亮显示。
 * @param {Object} rule 当前页面的翻译匹配规则
 * @returns {Promise<Array<string>>} 生词本里的单词数组
 */
async function getFavWords(rule) {
  if (
    rule.highlightWords &&
    rule.highlightWords !== OPT_HIGHLIGHT_WORDS_DISABLE
  ) {
    try {
      return Object.keys(await getWordsWithDefault());
    } catch (err) {
      logger.info("get fav words", err);
    }
  }

  return [];
}

const IFRAME_TEXT_CHECK_TIMEOUT = 1000;
const IFRAME_TEXT_IGNORE_SELECTOR = [
  "script",
  "style",
  "template",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "input",
  "textarea",
  "select",
  "option",
  ".notranslate",
  "[translate='no']",
  "[contenteditable='true']",
].join(", ");

function waitForDocumentReady(timeout = IFRAME_TEXT_CHECK_TIMEOUT) {
  if (document.readyState !== "loading") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("DOMContentLoaded", done);
      resolve();
    };
    const timer = setTimeout(done, timeout);
    document.addEventListener("DOMContentLoaded", done, { once: true });
  });
}

function hasIframeTranslatableText() {
  if (!document.body) return false;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        if (node.parentElement?.closest(IFRAME_TEXT_IGNORE_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  return Boolean(walker.nextNode());
}

async function waitForIframeTranslatableText() {
  await waitForDocumentReady();
  return hasIframeTranslatableText();
}

/**
 * 注册网页总结的消息监听器。
 * 监听来自 background 的 BRIDGE_SUMMARIZE_TRIGGER 消息，
 * 提取网页内容并调用 AI 生成总结，通过弹窗展示结果。
 * @param {Object} setting 当前设置对象
 */
function setupSummaryListener(setting) {
  // 获取当前 UI 语言并构建 i18n 函数
  const uiLang = browser?.i18n?.getUILanguage?.()?.startsWith("zh-TW")
    ? "zh_TW"
    : browser?.i18n?.getUILanguage?.()?.startsWith("zh")
    ? "zh"
    : browser?.i18n?.getUILanguage?.()?.startsWith("ja")
    ? "ja"
    : browser?.i18n?.getUILanguage?.()?.startsWith("ko")
    ? "ko"
    : "en";
  const i18n = newI18n(uiLang);

  const handleMessage = (message) => {
    if (message?.action !== BRIDGE_SUMMARIZE_TRIGGER) return;

    // 显示加载中状态
    showSummaryPopup({
      loading: true,
      i18n,
      onClose: () => {},
    });

    // 提取网页内容
    const content = extractPageContent();
    if (!content || content.trim().length < 50) {
      showSummaryPopup({
        error: "Page content is too short to summarize",
        i18n,
        onClose: () => hideSummaryPopup(),
      });
      return;
    }

    // 调用 background 生成总结
    requestWebSummary(content, (error, result) => {
      if (error) {
        showSummaryPopup({
          error,
          i18n,
          onClose: () => hideSummaryPopup(),
        });
      } else {
        showSummaryPopup({
          summaryText: result,
          i18n,
          onClose: () => hideSummaryPopup(),
        });
      }
    });
  };

  browser?.runtime?.onMessage?.addListener?.(handleMessage);
}

/**
 * 注册扩展上下文失效的全局兜底处理。
 * 扩展被重载/更新后，旧页面中残留的孤儿 content script 的所有 runtime/storage 调用
 * 都会抛出 "Extension context invalidated"，其中未被业务层捕获的会污染控制台。
 * 这里统一拦截此类未捕获异常，并向用户展示一次性的刷新页面提示 Banner。
 * @param {Function} [onInvalidated] 首次检测到上下文失效时回调一次（用于停止翻译器等清理）
 */
function setupContextInvalidatedGuard(onInvalidated) {
  let notified = false;

  window.addEventListener("unhandledrejection", (event) => {
    if (!isContextInvalidatedError(event.reason)) return;

    // 阻止默认的 "Uncaught (in promise)" 控制台报错
    event.preventDefault();

    if (notified) return;
    notified = true;

    // 默认 INFO 日志级别下 debug 静默，不向控制台引入警告
    logger.debug(
      "Extension context invalidated (extension was reloaded or updated). Please refresh the page."
    );

    // 失效后主动停止翻译器，避免 IntersectionObserver 继续发起注定失败的请求
    try {
      onInvalidated?.();
    } catch (err) {
      logger.debug("onInvalidated cleanup failed:", err);
    }

    // 仅顶层 frame 展示 Banner；iframe 中仅静默拦截，避免多个 iframe 各自弹提示
    if (!isIframe) {
      showErr(
        "扩展已更新，请刷新页面以恢复翻译功能 (Extension updated, please refresh the page)"
      );
    }
  });
}

/**
 * 前端翻译器的核心运行总入口。
 * @param {boolean} isUserscript 是否作为油猴 Userscript 脚本模式运行 (false 代表作为浏览器 Extension 运行)
 */
export async function run(isUserscript = false) {
  // 上下文失效时用于停止翻译器的引用；guard 注册在前、manager 创建在后，回调经引用延迟解析
  let managerRef = null;

  try {
    const href = document?.location?.href || "";

    // 扩展模式下优先挂载上下文失效兜底，覆盖后续所有异步调用链
    if (!isUserscript) {
      setupContextInvalidatedGuard(() => managerRef?.stop());
    }

    if (isUserscript) {
      ensureUserscriptGM();

      // 如果当前是设置面板 URL，先建立设置页专用代理，避免 storage 读写抢跑 GM 桥接。
      if (isOptionsPageHref(href)) {
        runSettingPage();
        return;
      }

      // 0. 执行核心数据迁移 (针对油猴等无后台更新事件的场景)
      const { runDataMigration } = await import("./libs/storage");
      await runDataMigration();
    }

    // 1. 加载本地设置
    const setting = await getSettingWithDefault();

    // 2. 初始化全局日志配置
    logger.setLevel(setting.logLevel);

    // 3. 页面类型拦截：若是 PDF / 图片 / 音视频等非 HTML 或纯文本媒体页面，则终止执行，避免注入多余 DOM
    const contentType = document?.contentType?.toLowerCase() || "";
    const isPdfDocument = contentType.includes("application/pdf");
    if (
      !contentType.includes("text") &&
      !contentType.includes("html") &&
      !isPdfDocument
    ) {
      logger.info("Skip running in document content type: ", contentType);
      return;
    }

    // 5. 网页黑名单校验，命中时彻底不启动翻译
    if (isInBlacklist(href, setting.blacklist)) {
      return;
    }

    // 5.1. iframe 空内容拦截：默认允许 iframe 翻译，但空 iframe 不继续挂载后续脚本
    if (isIframe && !(await waitForIframeTranslatableText())) {
      return;
    }

    // 6. 细粒度划词/输入框/鼠标悬停组件的专属黑名单拦截，若命中则单独禁用该交互组件
    if (isInBlacklist(href, setting.tranboxSetting?.blacklist)) {
      setting.tranboxSetting.transOpen = false;
    }

    if (isInBlacklist(href, setting.inputRule?.blacklist)) {
      setting.inputRule.transOpen = false;
    }

    if (isInBlacklist(href, setting.mouseHoverSetting?.blacklist)) {
      setting.mouseHoverSetting.useMouseHover = false;
    }

    // 7. 匹配当前网页专用的规则 (三级规则合并：个人 > 订阅 > 内置全局)
    const rule = await matchRule(href, setting);
    const favWords = await getFavWords(rule);
    const fabConfig = await getFabWithDefault();

    // 8. 创建翻译调度器管理器并启动
    const translatorManager = new TranslatorManager({
      setting,
      rule,
      fabConfig,
      favWords,
      isIframe,
      isUserscript,
      transboxOnly: isPdfDocument,
    });
    // 暴露给上下文失效兜底，失效时停止翻译器（含 IntersectionObserver、监听器等）
    managerRef = translatorManager;
    translatorManager.start();

    // 9. 若当前页面是嵌套的 iframe，不进行视频字幕翻译，避免多个 iframe 里重复跑字幕服务造成冲突
    if (isIframe || isPdfDocument) {
      return;
    }

    // 10. 启动视频字幕翻译子模块 (仅在顶级 frame 下运行)
    runSubtitle({ href, setting, rule, isUserscript });

    // 11. 在油猴环境下，每次进入顶级页面时尝试触发一次订阅规则的自动同步检查 (每日一次)
    if (isUserscript) {
      trySyncAllSubRules(setting);
    }

    // 12. 注册网页总结快捷键触发监听器（仅在顶级 frame 下运行）
    if (!isIframe) {
      setupSummaryListener(setting);
    }
  } catch (err) {
    console.error("[Bridge-Translator]", err);
    showErr(err.message); // 向前台页面绘制报错 Banner，便于用户感知与排查问题
  }
}
