function loadBrowserModule(apiFactory) {
  jest.resetModules();
  jest.doMock("webextension-polyfill", apiFactory);
  return require("./browser");
}

describe("browser extension context", () => {
  afterEach(() => {
    jest.dontMock("webextension-polyfill");
    jest.resetModules();
  });

  test("reports a valid context only when runtime and storage are available", () => {
    const { isExtContextValid } = loadBrowserModule(() => ({
      runtime: { id: "extension-id" },
      storage: { local: {} },
    }));

    expect(isExtContextValid()).toBe(true);
  });

  test("reports an invalid context when the polyfill cannot initialize", () => {
    const { browser, isExtContextValid } = loadBrowserModule(() => {
      throw new Error(
        "This script should only be loaded in a browser extension."
      );
    });

    expect(browser).toBeUndefined();
    expect(isExtContextValid()).toBe(false);
  });

  test("reports an invalid context when storage is unavailable", () => {
    const { isExtContextValid } = loadBrowserModule(() => ({
      runtime: { id: "extension-id" },
    }));

    expect(isExtContextValid()).toBe(false);
  });
});
