import { DEFAULT_WEB_SUMMARY_SETTING } from "../config";
import { useSetting } from "./Setting";

/**
 * 网页总结相关偏好设置的读取与更新自定义 Hook
 * @returns {object} { webSummarySetting, updateWebSummary }
 */
export function useWebSummary() {
  const { setting, updateChild } = useSetting();
  const webSummarySetting =
    setting?.webSummarySetting || DEFAULT_WEB_SUMMARY_SETTING;
  const updateWebSummary = updateChild("webSummarySetting");
  return { webSummarySetting, updateWebSummary };
}