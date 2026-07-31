/**
 * @file keepAlive.js
 * @description MV3 Service Worker 保活模块。
 * Chrome 会在 background Service Worker 空闲约 30 秒后将其回收，而"进行中的 fetch"
 * 与"静默的长连接 Port"都不会重置空闲计时器。当 background 正在代理耗时请求
 * （如 AI 断句/翻译的大 prompt 首响应超过 30 秒）时，SW 被回收会导致 Port 静默断开、
 * sendMessage 通道关闭，前台表现为字幕/翻译一直加载。
 * 本模块通过"存在进行中任务期间周期性调用扩展 API（每次调用重置空闲计时器，Chrome 114+）"
 * 的官方认可方式维持 SW 存活，任务清零后立即停止，避免无谓常驻。
 */

// 保活心跳间隔：必须小于 Chrome 的 30 秒空闲回收阈值，留出调度余量
export const KEEP_ALIVE_INTERVAL_MS = 20 * 1000;

/**
 * 创建一个基于引用计数的 Service Worker 保活器。
 *
 * @param {Object} param0 参数对象。
 * @param {Function} param0.ping 周期性执行的扩展 API 调用（如 runtime.getPlatformInfo），
 *   仅用于重置 SW 空闲计时器，返回值与异常均被忽略。
 * @param {number} [param0.intervalMs=KEEP_ALIVE_INTERVAL_MS] 心跳间隔毫秒数。
 * @returns {{begin: Function, end: Function, getActiveCount: Function}} 保活器实例。
 */
export function createKeepAlive({ ping, intervalMs = KEEP_ALIVE_INTERVAL_MS }) {
  let activeCount = 0;
  let timer = null;

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    /**
     * 登记一个进行中的长任务；首个任务会启动保活心跳。
     */
    begin() {
      activeCount += 1;
      if (timer) return;
      timer = setInterval(() => {
        try {
          // ping 只为触发扩展 API 调用以重置空闲计时器，结果与失败均可忽略
          Promise.resolve(ping()).catch(() => {});
        } catch {
          // 同步异常同样忽略，保活失败不应影响正在进行的请求
        }
      }, intervalMs);
    },

    /**
     * 注销一个长任务；全部任务结束后停止心跳，允许 SW 正常回收。
     */
    end() {
      activeCount = Math.max(0, activeCount - 1);
      if (activeCount === 0) {
        stop();
      }
    },

    /**
     * 当前进行中的任务数（诊断与测试用）。
     *
     * @returns {number} 任务计数。
     */
    getActiveCount() {
      return activeCount;
    },
  };
}
