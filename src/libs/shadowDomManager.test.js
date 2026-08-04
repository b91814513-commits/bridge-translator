import React from "react";
import { act } from "react-dom/test-utils";
import ShadowDomManager from "./shadowDomManager";

const TestComponent = ({ label }) => {
  return React.createElement("span", { "data-testid": "label" }, label);
};

const flush = () => act(async () => {});

describe("ShadowDomManager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("show mounts component into shadow root with initial props", async () => {
    const manager = new ShadowDomManager({
      id: "test-shadow",
      reactComponent: TestComponent,
      props: { label: "initial" },
    });

    act(() => manager.show());
    await flush();

    expect(manager.isVisible).toBe(true);
    const host = document.getElementById("test-shadow");
    const text = host.shadowRoot.querySelector('[data-testid="label"]');
    expect(text.textContent).toBe("initial");
  });

  test("show(newProps) on already-mounted hidden component applies new props", async () => {
    const manager = new ShadowDomManager({
      id: "test-shadow",
      reactComponent: TestComponent,
      props: { label: "initial" },
    });

    act(() => manager.show());
    await flush();
    act(() => manager.hide());
    expect(manager.isVisible).toBe(false);

    // 已挂载隐藏组件，携带新 props 调用 show，必须应用新 props 并重新渲染
    act(() => manager.show({ label: "re-rendered" }));
    await flush();

    expect(manager.isVisible).toBe(true);
    const host = document.getElementById("test-shadow");
    const text = host.shadowRoot.querySelector('[data-testid="label"]');
    expect(text.textContent).toBe("re-rendered");
    // 内部状态同步更新
    expect(manager._props).toEqual({ label: "re-rendered" });
  });
});