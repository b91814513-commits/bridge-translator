/**
 * XMLHttpRequest / fetch 拦截注入器
 * 重写页面原生的 XMLHttpRequest.prototype.open 与 window.fetch，拦截 YouTube 的
 * `timedtext` 字幕接口请求（现代 YouTube 播放器已大量改用 fetch 获取字幕）。
 * 拦截成功后，通过 postMessage 将字幕原始响应文本派发给上层 Content Script，
 * 以实现视频双语字幕渲染。
 *
 * 注意：消息 type 必须与 config/msg.js 中的 MSG_XHR_DATA_YOUTUBE 保持一致，
 * 此前曾因项目改名后注入器仍硬编码旧值（KISS_ 前缀）导致拦截数据被静默丢弃。
 */
import { MSG_XHR_DATA_YOUTUBE } from "../config/msg";

export const XMLHttpRequestInjector = () => {
  // 向 Content Script 回传拦截到的字幕响应（带安全的同源限制）
  const postSubtitleData = (url, response) => {
    try {
      if (!url || !response) return;
      window.postMessage(
        { type: MSG_XHR_DATA_YOUTUBE, url, response },
        window.location.origin
      );
    } catch (err) {
      // 回传失败不影响页面原始请求
    }
  };

  // 1. 劫持 XMLHttpRequest（兼容仍使用 XHR 的旧播放器路径）
  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args) {
      const url = args[1];
      // 匹配 YouTube 的 timedtext 字幕网络请求链接
      if (typeof url === "string" && url.includes("timedtext")) {
        this.addEventListener("load", function () {
          postSubtitleData(this.responseURL, this.responseText);
        });
      }
      return originalOpen.apply(this, args);
    };
  } catch (err) {
    console.log("XMLHttpRequestInjector", err);
  }

  // 2. 劫持 window.fetch（现代 YouTube 播放器用 fetch 请求 timedtext，
  //    只劫持 XHR 会导致拦截永远不命中，字幕停留在“等待字幕”状态）
  try {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const input = args[0];
      const url =
        typeof input === "string"
          ? input
          : input && typeof input.url === "string"
            ? input.url
            : String(input ?? "");

      const fetchPromise = originalFetch.apply(this, args);

      if (typeof url === "string" && url.includes("timedtext")) {
        // 注意：必须先于页面消费方 clone 响应，且不能改变原 Promise 的返回
        fetchPromise
          .then((response) => {
            try {
              response
                .clone()
                .text()
                .then((text) => postSubtitleData(response.url || url, text))
                .catch(() => {});
            } catch (err) {
              // clone 失败（如响应已被锁定）时静默放弃本次拦截
            }
          })
          .catch(() => {});
      }

      return fetchPromise;
    };
  } catch (err) {
    console.log("FetchInjector", err);
  }
};
