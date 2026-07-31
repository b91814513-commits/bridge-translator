/**
 * @file index.js
 * @description 网页总结模块入口。负责创建 React Root 并渲染 SummaryPopup 组件，
 * 提供 show/hide/destroy 生命周期管理接口。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import ThemeProvider from "../../hooks/Theme";
import SummaryPopup from "./SummaryPopup";

const SUMMARY_CONTAINER_ID = "bridge-summary-popup";

let reactRoot = null;
let hostElement = null;
let emotionCache = null;

/**
 * 挂载并显示总结弹窗。
 * 若容器尚未创建则首次挂载，否则仅更新 props 并显示。
 * REVIEW: 弹窗必须挂载在 Shadow DOM 内，并将 emotion cache 的 container 指向 shadow root，
 * 与 tranbox.js / shadowDomManager.js 的约定保持一致。否则 ThemeProvider 内的 CssBaseline
 * 会把 body 背景色（淡粉色）等全局样式注入宿主页面 <head>，导致整个网页变粉。
 *
 * @param {Object} options
 * @param {string} options.summaryText 总结文本
 * @param {boolean} options.loading 是否加载中
 * @param {string} options.error 错误信息
 * @param {Function} options.onClose 关闭回调
 * @param {Function} options.i18n 国际化函数
 */
export function showSummaryPopup({
  summaryText = "",
  loading = false,
  error = "",
  onClose,
  i18n = (key, fallback) => fallback || key,
} = {}) {
  if (!hostElement) {
    hostElement = document.createElement("div");
    hostElement.id = SUMMARY_CONTAINER_ID;
    document.body.appendChild(hostElement);

    // Shadow DOM 隔离样式，CssBaseline 的 html/body 选择器在 shadow 内匹配不到宿主页面
    const shadowContainer = hostElement.attachShadow({ mode: "open" });
    const appRoot = document.createElement("div");
    appRoot.className = `${SUMMARY_CONTAINER_ID}_wrapper notranslate`;
    shadowContainer.appendChild(appRoot);

    emotionCache = createCache({
      key: "bridge-summary",
      prepend: true,
      container: shadowContainer,
    });

    reactRoot = ReactDOM.createRoot(appRoot);
  } else {
    hostElement.style.display = "";
  }

  renderPopup({ summaryText, loading, error, onClose, i18n });
}

/**
 * 隐藏总结弹窗（不销毁 React Root）。
 */
export function hideSummaryPopup() {
  if (hostElement) {
    hostElement.style.display = "none";
  }
}

/**
 * 销毁总结弹窗，卸载 React Root 并移除 DOM 节点。
 */
export function destroySummaryPopup() {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  if (hostElement) {
    hostElement.remove();
    hostElement = null;
  }
  emotionCache = null;
}

/**
 * 渲染 SummaryPopup 组件到已挂载的 React Root。
 */
function renderPopup({ summaryText, loading, error, onClose, i18n }) {
  const handleClose = () => {
    hideSummaryPopup();
    onClose?.();
  };

  reactRoot.render(
    <React.StrictMode>
      <CacheProvider value={emotionCache}>
        <ThemeProvider>
          <SummaryPopup
            summaryText={summaryText}
            loading={loading}
            error={error}
            onClose={handleClose}
            i18n={i18n}
          />
        </ThemeProvider>
      </CacheProvider>
    </React.StrictMode>
  );
}
