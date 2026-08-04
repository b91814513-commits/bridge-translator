import { getBatchQueue, clearAllBatchQueue } from "./batchQueue";

const noop = () => [];

describe("batchQueue", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("clearAllBatchQueue destroys all queues and clears the map", () => {
    const q1 = getBatchQueue("api-a", noop);
    const q2 = getBatchQueue("api-b", noop);

    const destroySpy1 = jest.spyOn(q1, "destroy");
    const destroySpy2 = jest.spyOn(q2, "destroy");

    // 消费两个队列，避免 destroy 时产生未处理的 rejected promise
    const p1 = q1.addTask("t1", {});
    const p2 = q2.addTask("t2", {});
    p1.catch(() => {});
    p2.catch(() => {});

    clearAllBatchQueue();

    expect(destroySpy1).toHaveBeenCalled();
    expect(destroySpy2).toHaveBeenCalled();
  });

  test("getBatchQueue returns a fresh usable instance after clearAllBatchQueue", () => {
    const taskFn = jest.fn(() => []);

    const first = getBatchQueue("api-x", taskFn);
    const pending = first.addTask("hello", {});
    pending.catch(() => {});

    clearAllBatchQueue();

    // 重新获取必须返回全新实例，而非已被 destroy 的死实例
    const second = getBatchQueue("api-x", taskFn);
    expect(second).not.toBe(first);

    // 新实例可正常添加任务
    const promise = second.addTask("world", {});
    expect(promise).toBeInstanceOf(Promise);
  });

  test("destroy rejects pending tasks in a queue", async () => {
    const q = getBatchQueue("api-reject", noop);
    const promise = q.addTask("text", {});

    q.destroy();

    await expect(promise).rejects.toThrow("Queue instance was destroyed.");
  });
});