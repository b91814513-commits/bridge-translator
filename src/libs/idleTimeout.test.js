jest.mock("./storage", () => ({
  getSettingWithDefault: jest.fn(() => Promise.resolve({ httpTimeout: 1000 })),
}));

jest.mock("../config", () => ({
  CLIENT_EXTS: [],
  CLIENT_FIREFOX: "firefox",
  CLIENT_USERSCRIPT: "userscript",
  CLIENT_WEB: "web",
  DEFAULT_HTTP_TIMEOUT: 30,
  MSG_FETCH: "kiss_fetch",
}));

jest.mock("./log", () => ({
  kissLog: jest.fn(),
}));

import { createIdleTimeoutController } from "./request";

describe("createIdleTimeoutController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("aborts when no activity happens within the idle window", () => {
    const idle = createIdleTimeoutController(1000);
    expect(idle.signal.aborted).toBe(false);

    jest.advanceTimersByTime(999);
    expect(idle.signal.aborted).toBe(false);

    jest.advanceTimersByTime(1);
    expect(idle.signal.aborted).toBe(true);
  });

  test("does not abort while activity keeps bumping the timer", () => {
    const idle = createIdleTimeoutController(1000);

    // 每 800ms 有一次数据到达（bump），始终未达空闲阈值
    for (let i = 0; i < 10; i += 1) {
      jest.advanceTimersByTime(800);
      idle.bump();
    }
    expect(idle.signal.aborted).toBe(false);

    // 停止 bump 后，超过阈值才中断
    jest.advanceTimersByTime(1000);
    expect(idle.signal.aborted).toBe(true);
  });

  test("clear stops the timer so no late abort fires", () => {
    const idle = createIdleTimeoutController(1000);

    idle.clear();
    jest.advanceTimersByTime(5000);
    expect(idle.signal.aborted).toBe(false);
  });

  test("never arms a timer when idleMs is falsy", () => {
    const idle = createIdleTimeoutController(0);

    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(idle.signal.aborted).toBe(false);

    // bump 在未启用超时时应为无操作，不抛错
    expect(() => idle.bump()).not.toThrow();
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(idle.signal.aborted).toBe(false);
  });
});
