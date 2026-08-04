import React from "react";
import ReactDOM from "react-dom/client";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import { logger } from "./log";

export default class ShadowDomManager {
  #hostElement = null;
  #reactRoot = null;
  #isVisible = false;
  #isProcessing = false;

  _id;
  _className;
  _ReactComponent;
  _props;

  constructor({
    id,
    className = "",
    reactComponent,
    props = {},
    rootElement = document.body,
  }) {
    if (!id || !reactComponent) {
      throw new Error("ID and a React Component must be provided.");
    }
    this._id = id;
    this._className = className;
    this._ReactComponent = reactComponent;
    this._props = props;
    this._rootElement = rootElement;
  }

  get isVisible() {
    return this.#isVisible;
  }

  /**
   * 显示组件
   * 如果组件当前已被挂载且处于隐藏状态，此时调用 `show(props)` 并传入了新的 props，
   * 必须应用并重新渲染新 props，否则新传入的 props 根本不会被应用到界面上，仍然只显示旧属性值。
   * @param {Object} props - 可选的新 props
   */
  show(props) {
    if (this.#isVisible || this.#isProcessing) {
      return;
    }

    const useProps = props || this._props;

    if (!this.#hostElement) {
      this.#isProcessing = true;
      try {
        this.#mount(useProps);
      } catch (error) {
        logger.warn(`Failed to mount component with id "${this._id}":`, error);
        this.#isProcessing = false;
        return;
      } finally {
        this.#isProcessing = false;
      }
    } else if (props) {
      // 组件已挂载，但传入了新的 props，必须更新并重新渲染
      this._props = props;
      const cache = createCache({
        key: this._id,
        prepend: true,
        container: this.#hostElement.shadowRoot,
      });
      const ComponentToRender = this._ReactComponent;
      this.#reactRoot.render(
        <React.StrictMode>
          <CacheProvider value={cache}>
            <ComponentToRender {...{ ...this._props, onClose: this.hide.bind(this) }} />
          </CacheProvider>
        </React.StrictMode>
      );
    }

    this.#hostElement.style.display = "";
    this.#isVisible = true;
  }

  hide() {
    if (!this.#isVisible || !this.#hostElement) {
      return;
    }
    this.#hostElement.style.display = "none";
    this.#isVisible = false;
  }

  destroy() {
    if (!this.#hostElement) {
      return;
    }
    this.#isProcessing = true;

    if (this.#reactRoot) {
      this.#reactRoot.unmount();
    }

    this.#hostElement.remove();

    this.#hostElement = null;
    this.#reactRoot = null;
    this.#isVisible = false;
    this.#isProcessing = false;
    logger.info(`Component with id "${this._id}" has been destroyed.`);
  }

  toggle(props) {
    if (this.#isVisible) {
      this.hide();
    } else {
      this.show(props || this._props);
    }
  }

  #mount(props) {
    const host = document.createElement("div");
    host.id = this._id;
    if (this._className) {
      host.className = this._className;
    }

    this._rootElement.appendChild(host);
    this.#hostElement = host;
    const shadowContainer = host.attachShadow({ mode: "open" });
    const appRoot = document.createElement("div");
    appRoot.className = `${this._id}_wrapper notranslate`;
    shadowContainer.appendChild(appRoot);

    const cache = createCache({
      key: this._id,
      prepend: true,
      container: shadowContainer,
    });

    const enhancedProps = {
      ...props,
      onClose: this.hide.bind(this),
    };

    const ComponentToRender = this._ReactComponent;
    this.#reactRoot = ReactDOM.createRoot(appRoot);
    this.#reactRoot.render(
      <React.StrictMode>
        <CacheProvider value={cache}>
          <ComponentToRender {...enhancedProps} />
        </CacheProvider>
      </React.StrictMode>
    );
  }
}
