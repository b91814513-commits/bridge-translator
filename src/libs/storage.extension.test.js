function loadExtensionStorage(browser) {
  jest.resetModules();
  jest.doMock("../config", () => ({
    DEFAULT_RULES: [],
    DEFAULT_SETTING: {},
    DEFAULT_SYNC: {},
    BUILTIN_RULES: [],
    SETTINGS_VERSION_V2: 2,
    getSettingVersion: jest.fn(),
    migrateSettingPromptsToV2: jest.fn(),
  }));
  jest.doMock("./client", () => ({ isExt: true, isGm: false }));
  jest.doMock("./browser", () => ({ browser }));
  jest.doMock("./log", () => ({ kissLog: jest.fn() }));
  jest.doMock("./utils", () => ({ debounce: (fn) => fn }));
  jest.doMock("./gm", () => ({ getGmMethod: jest.fn() }));
  return require("./storage").storage;
}

describe("extension storage context guard", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../config");
    jest.dontMock("./client");
    jest.dontMock("./browser");
    jest.dontMock("./log");
    jest.dontMock("./utils");
    jest.dontMock("./gm");
  });

  test("rejects reads, writes, and deletes after context invalidation", async () => {
    const storage = loadExtensionStorage(undefined);
    const expectedMessage = "Extension context invalidated";

    await expect(storage.get("key")).rejects.toThrow(expectedMessage);
    await expect(storage.set("key", "value")).rejects.toThrow(expectedMessage);
    await expect(storage.del("key")).rejects.toThrow(expectedMessage);
  });

  test("uses storage.local while the extension context is valid", async () => {
    const local = {
      get: jest.fn(async () => ({ key: "value" })),
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
    };
    const storage = loadExtensionStorage({
      runtime: { id: "extension-id" },
      storage: { local },
    });

    await expect(storage.get("key")).resolves.toBe("value");
    await storage.set("key", "next");
    await storage.del("key");

    expect(local.get).toHaveBeenCalledWith(["key"]);
    expect(local.set).toHaveBeenCalledWith({ key: "next" });
    expect(local.remove).toHaveBeenCalledWith(["key"]);
  });
});
