import React from "react";
import { act } from "react-dom/test-utils";
import DomManager from "./domManager";

const TestComponent = ({ label }) => {
  return React.createElement("span", { "data-testid": "label" }, label);
};

const flush = () => act(async () => {});

describe("DomManager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("show mounts and renders the component with initial props", async () => {
    const manager = new DomManager({
      id: "test-dom",
      reactComponent: TestComponent,
      props: { label: "initial" },
    });

    act(() => manager.show());
    await flush();

    expect(manager.isVisible).toBe(true);
    expect(manager._props).toEqual({ label: "initial" });
    expect(document.body.querySelector('[data-testid="label"]').textContent).toBe(
      "initial"
    );
  });

  test("updateProps synchronizes internal _props and rerenders", async () => {
    const manager = new DomManager({
      id: "test-dom",
      reactComponent: TestComponent,
      props: { label: "initial" },
    });

    act(() => manager.show());
    await flush();
    act(() => manager.updateProps({ label: "updated" }));
    await flush();

    // 内部状态同步更新
    expect(manager._props).toEqual({ label: "updated" });
    // 界面重新渲染
    expect(document.body.querySelector('[data-testid="label"]').textContent).toBe(
      "updated"
    );
  });

  test("hide then show() without props uses the latest _props", async () => {
    const manager = new DomManager({
      id: "test-dom",
      reactComponent: TestComponent,
      props: { label: "initial" },
    });

    act(() => manager.show());
    await flush();
    act(() => manager.updateProps({ label: "updated" }));
    await flush();
    act(() => manager.hide());
    act(() => manager.show());
    await flush();

    expect(manager.isVisible).toBe(true);
    expect(document.body.querySelector('[data-testid="label"]').textContent).toBe(
      "updated"
    );
  });
});