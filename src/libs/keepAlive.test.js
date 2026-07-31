import { createKeepAlive, KEEP_ALIVE_INTERVAL_MS } from "./keepAlive";

describe("createKeepAlive", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("starts pinging after begin and stops after last end", () => {
    const ping = jest.fn().mockResolvedValue(undefined);
    const keepAlive = createKeepAlive({ ping });

    keepAlive.begin();
    expect(keepAlive.getActiveCount()).toBe(1);
    expect(ping).not.toHaveBeenCalled();

    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS);
    expect(ping).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS * 2);
    expect(ping).toHaveBeenCalledTimes(3);

    keepAlive.end();
    expect(keepAlive.getActiveCount()).toBe(0);

    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS * 3);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  test("keeps a single timer while multiple tasks overlap", () => {
    const ping = jest.fn().mockResolvedValue(undefined);
    const keepAlive = createKeepAlive({ ping });

    keepAlive.begin();
    keepAlive.begin();
    expect(keepAlive.getActiveCount()).toBe(2);

    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS);
    // 两个任务共享同一个心跳定时器，不会叠加 ping 频率
    expect(ping).toHaveBeenCalledTimes(1);

    keepAlive.end();
    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS);
    // 仍有任务进行中，心跳继续
    expect(ping).toHaveBeenCalledTimes(2);

    keepAlive.end();
    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS * 2);
    expect(ping).toHaveBeenCalledTimes(2);
  });

  test("clamps active count at zero on extra end calls", () => {
    const ping = jest.fn().mockResolvedValue(undefined);
    const keepAlive = createKeepAlive({ ping });

    keepAlive.end();
    keepAlive.end();
    expect(keepAlive.getActiveCount()).toBe(0);

    // 多余的 end 不应破坏后续 begin 的保活能力
    keepAlive.begin();
    jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS);
    expect(ping).toHaveBeenCalledTimes(1);

    keepAlive.end();
  });

  test("swallows ping failures without stopping the heartbeat", () => {
    const ping = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync failure");
      })
      .mockImplementationOnce(() => Promise.reject(new Error("async failure")))
      .mockResolvedValue(undefined);
    const keepAlive = createKeepAlive({ ping });

    keepAlive.begin();

    expect(() =>
      jest.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS * 3)
    ).not.toThrow();
    expect(ping).toHaveBeenCalledTimes(3);

    keepAlive.end();
  });

  test("supports a custom heartbeat interval", () => {
    const ping = jest.fn().mockResolvedValue(undefined);
    const keepAlive = createKeepAlive({ ping, intervalMs: 5000 });

    keepAlive.begin();
    jest.advanceTimersByTime(4999);
    expect(ping).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(ping).toHaveBeenCalledTimes(1);

    keepAlive.end();
  });
});
