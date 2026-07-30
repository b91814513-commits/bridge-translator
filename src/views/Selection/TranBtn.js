import { createPortal } from "react-dom";
import { isMobile } from "../../libs/mobile";
import { FAVICON_BASE64 } from "../../components/Logo";

/**
 * 划词翻译悬浮触发按钮组件 (网页上划词后出现的品牌小图标)
 *
 * @param {Object} props
 * @param {Function} props.onTrigger - 点击/触摸按钮时的翻译触发回调
 * @param {string} props.btnEvent - 触发按钮动作的事件类型（如 "onMouseUp" 或 "onTouchEnd"）
 * @param {Object} props.position - 选区计算出的原始绝对坐标 { x, y }
 * @param {number} props.btnOffsetX - 悬浮按钮的横向偏移量
 * @param {number} props.btnOffsetY - 悬浮按钮的纵向偏移量
 */
export default function TranBtn({
  onTrigger,
  btnEvent,
  position,
  btnOffsetX,
  btnOffsetY,
}) {
  // 根据偏移配置，计算得出按钮的物理定位坐标
  const left = position.x + btnOffsetX;
  const top = position.y + btnOffsetY;

  const buttonElement = (
    <div
      className="KT-tranbtn"
      style={{
        cursor: "pointer",
        position: "absolute",
        left,
        top,
        zIndex: 2147483647,
      }}
      // 阻止点击按钮时清除文本选区，防止 Hook 立刻隐藏按钮
      // REVIEW: 悬浮按钮使用 position: "absolute" 且挂载在 document.body 下。若网页的 body 元素包含 position: relative 或 transform 属性，会建立新的包含块，可能导致悬浮按钮相对于选区发生严重的定位偏差。为规避这一宿主页面样式的干扰，建议将定位方式改为 position: "fixed"，或直接挂载在插件独立的 Shadow DOM 内。
      onMouseDown={(e) => e.preventDefault()}
      {...{ [btnEvent]: onTrigger }}
    >
      <img
        src={FAVICON_BASE64}
        alt=""
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        style={{
          width: isMobile ? "32px" : "20px",
          height: isMobile ? "32px" : "20px",
          objectFit: "contain",
          display: "block",
          borderRadius: "4px",
          boxShadow: "0 1px 4px rgba(236, 64, 122, 0.4)",
        }}
      />
    </div>
  );

  // 利用 createPortal 直接渲染挂载在宿主页面的 body 最外层
  return createPortal(buttonElement, document.body);
}
