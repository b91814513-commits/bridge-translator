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

/**
 * 挂载并显示总结弹窗。
 * 若容器尚未创建则首次挂载，否则仅更新 props 并显示。
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

    const cache = createCache({
      key: "bridge-summary",
      prepend: true,
    });

    reactRoot = ReactDOM.createRoot(hostElement);
    renderPopup({ summaryText, loading, error, onClose, i18n, cache });
  } else {
    hostElement.style.display = "";
    const cache = createCache({
      key: "bridge-summary",
      prepend: true,
    });
    renderPopup({ summaryText, loading, error, onClose, i18n, cache });
  }
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
}

/**
 * 渲染 SummaryPopup 组件到已挂载的 React Root。
 */
function renderPopup({ summaryText, loading, error, onClose, i18n, cache }) {
  const handleClose = () => {
    hideSummaryPopup();
    onClose?.();
  };

  reactRoot.render(
    <React.StrictMode>
      <CacheProvider value={cache}>
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
