import { TaskPool } from "./pool";

describe("TaskPool", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("clear() rejects pending tasks in the queue", async () => {
    const pool = new TaskPool(0, 1);
    const fn = jest.fn(() => new Promise(() => {}));
    const promise = pool.push(fn, {});

    const assertion = expect(promise).rejects.toBe("the task pool was cleared");
    pool.clear();
    await assertion;
  });

  test("clear() terminates delayed retry tasks so no zombie task resurrects", async () => {
    const pool = new TaskPool(0, 1, 1000);
    const fn = jest
      .fn()
      .mockImplementation(() => Promise.reject(new Error("fail once")));

    const promise = pool.push(fn, {});
    // 推进调度定时器，让首次执行进入 catch 并安排延迟重试
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    await Promise.resolve();

    // 立即 clear，此时重试定时器尚未触发
    pool.clear();
    const assertion = expect(promise).rejects.toBe("the task pool was cleared");

    // 推进时间超过重试间隔，验证重试回调不把任务重新放回队列
    jest.advanceTimersByTime(5000);

    await assertion;
    expect(fn).toHaveBeenCalledTimes(1); // 重试未触发，仅首次执行
  });
});