import Sval from "sval";

/**
 * 全局共享的 Sval JS 沙盒解释器实例
 * 用于在隔离的安全沙盒中执行用户自定义的 Hook 脚本（例如翻译前的文本处理、翻译后的译文调整等）。
 *
 * 注意：该实例为共享单例，仅用于初始化阶段一次性执行 injectJs 的场景。
 * 并发场景（如逐次翻译的 transStartHook / transEndHook）必须使用 createHookInterpreter()，
 * 每次执行创建独立实例，避免共享沙盒状态被并发任务互相覆盖。
 */
export const interpreter = new Sval({
  // 支持的 ECMAScript 语法版本
  // 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 或 "latest"
  ecmaVer: "latest",
  // 代码源类型，"script" 表示普通脚本，"module" 表示 ES 模块
  sourceType: "script",
  // 是否开启沙盒模式以隔离运行环境，防止执行恶意代码或污染宿主环境的全局 Window 变量
  sandBox: true,
});

/**
 * 创建独立的 Sval 沙盒解释器实例。
 * 用于每次翻译 Hook（transStartHook / transEndHook）执行时创建全新实例，
 * 彻底隔离共享全局状态，避免并发任务相互覆盖 Hook 函数引用。
 * @returns {Sval} 独立沙盒解释器实例
 */
export const createHookInterpreter = () =>
  new Sval({
    ecmaVer: "latest",
    sourceType: "script",
    sandBox: true,
  });
