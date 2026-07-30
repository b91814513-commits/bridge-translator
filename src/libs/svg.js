import { FAVICON_BASE64 } from "../components/Logo/icon.base64.js";

/**
 * 各种 UI 动画和图标的 SVG 静态模板
 */
export const loadingSvg = `<svg viewBox="-20 0 100 100" 
     style="display: inline-block; width: 1em; height: 1em; vertical-align: middle;">
  <circle fill="#EC407A" stroke="none" cx="6" cy="50" r="6">
    <animateTransform attributeName="transform" dur="1s" type="translate" values="0 15 ; 0 -15; 0 15" repeatCount="indefinite" begin="0.1"/>
  </circle>
  <circle fill="#EC407A" stroke="none" cx="30" cy="50" r="6">
    <animateTransform attributeName="transform" dur="1s" type="translate" values="0 10 ; 0 -10; 0 10" repeatCount="indefinite" begin="0.2"/>
  </circle>
  <circle fill="#EC407A" stroke="none" cx="54" cy="50" r="6">
    <animateTransform attributeName="transform" dur="1s" type="translate" values="0 5 ; 0 -5; 0 5" repeatCount="indefinite" begin="0.3"/>
  </circle>
</svg>
`;

// 内部辅助函数：在特定的 XML 命名空间中创建 SVG 元素并设置属性
function createSVGElement(tag, attributes) {
  const svgNS = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(svgNS, tag);
  for (const key in attributes) {
    el.setAttribute(key, attributes[key]);
  }
  return el;
}

/**
 * 动态创建 Loading 动画 SVG 元素节点
 * @returns {SVGElement}
 */
export function createLoadingSVG() {
  const svg = createSVGElement("svg", {
    viewBox: "-20 0 100 100",
    style:
      "display: inline-block; width: 1em; height: 1em; vertical-align: middle;",
  });

  const circleData = [
    { cx: "6", begin: "0.1", values: "0 15 ; 0 -15; 0 15" },
    { cx: "30", begin: "0.2", values: "0 10 ; 0 -10; 0 10" },
    { cx: "54", begin: "0.3", values: "0 5 ; 0 -5; 0 5" },
  ];

  circleData.forEach((data) => {
    const circle = createSVGElement("circle", {
      fill: "#EC407A",
      stroke: "none",
      cx: data.cx,
      cy: "50",
      r: "6",
    });
    const animation = createSVGElement("animateTransform", {
      attributeName: "transform",
      dur: "1s",
      type: "translate",
      values: data.values,
      repeatCount: "indefinite",
      begin: data.begin,
    });
    circle.appendChild(animation);
    svg.appendChild(circle);
  });

  return svg;
}

/**
 * 动态创建翻译失败重试图标 SVG 元素节点并绑定悬浮高亮事件
 * @returns {SVGElement}
 */
export function createRetrySVG() {
  const svg = createSVGElement("svg", {
    viewBox: "0 0 24 24",
    style:
      "display: inline-block; width: 1em; height: 1em; vertical-align: middle; cursor: pointer; opacity: 0.7;",
  });

  svg.addEventListener("mouseenter", () => {
    svg.style.opacity = "1";
  });
  svg.addEventListener("mouseleave", () => {
    svg.style.opacity = "0.7";
  });

  // 圆弧还原箭头路径 (↻)
  const path = createSVGElement("path", {
    d: "M17.65 6.35A7.958 7.958 0 0 0 12 4C7.58 4 4.01 7.58 4.01 12S7.58 20 12 20c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    fill: "#F44336",
  });

  svg.appendChild(path);
  return svg;
}

/**
 * 动态创建 Bridge Translator 主徽标 LOGO 元素节点
 * 基于 Base64 内联的品牌图标，确保在页面注入脚本等无法访问扩展静态资源的环境下也能正常展示
 * @param {Object} [options]
 * @param {string} [options.width] - 宽度（像素）
 * @param {string} [options.height] - 高度（像素）
 * @param {boolean} [options.isSelected] - 是否处于选中状态（叠加粉色高亮描边）
 * @returns {HTMLImageElement}
 */
export function createLogoSVG({
  width = "24",
  height = "24",
  isSelected = false,
} = {}) {
  const img = document.createElement("img");
  img.src = FAVICON_BASE64;
  img.alt = "Bridge Translator";
  img.draggable = false;

  Object.assign(img.style, {
    width: `${parseInt(width, 10) || 24}px`,
    height: `${parseInt(height, 10) || 24}px`,
    objectFit: "contain",
    display: "inline-block",
    verticalAlign: "middle",
    borderRadius: "4px",
    pointerEvents: "none",
  });

  // 选中状态：叠加粉色主题高亮描边，区分菜单开/关
  if (isSelected) {
    img.style.boxShadow = "0 0 0 2px rgba(236, 64, 122, 0.9)";
    img.style.background = "rgba(236, 64, 122, 0.35)";
  }

  return img;
}
