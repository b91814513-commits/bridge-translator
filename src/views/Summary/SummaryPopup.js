/**
 * @file SummaryPopup.js
 * @description 网页总结弹窗组件。固定在页面右上角显示，使用 Markdown 渲染 AI 生成的网页总结，
 * 提供清晰的排版、滚动阅读、复制全文和关闭功能。
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { useTheme } from "@mui/material/styles";
import ReactMarkdown from "react-markdown";
import { normalizeSummaryText } from "../../libs/webSummary";

/**
 * 网页总结弹窗组件。
 * 固定在页面右上角，宽度约 420px，最大高度 82vh，内容区可滚动。
 *
 * @param {Object} props
 * @param {string} props.summaryText 总结的原始文本（可能是 Markdown、纯文本或被包裹的 JSON）
 * @param {boolean} props.loading 是否正在加载中
 * @param {string} props.error 错误信息
 * @param {Function} props.onClose 关闭回调
 * @param {Function} props.i18n 国际化翻译函数 (key) => string
 */
export default function SummaryPopup({
  summaryText = "",
  loading = false,
  error = "",
  onClose,
  i18n = (key, fallback) => fallback || key,
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  // 规范化总结文本：兜底解包 JSON / 代码围栏，得到干净的 Markdown 用于渲染与复制
  const normalized = useMemo(
    () => normalizeSummaryText(summaryText),
    [summaryText]
  );

  // 封装 i18n 函数，支持 fallback 参数
  const t = useCallback(
    (key, fallback) => {
      const result = i18n(key);
      return result || fallback || key;
    },
    [i18n]
  );

  // 支持 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // 复制总结全文到剪贴板，并给出短暂的“已复制”反馈
  const handleCopy = useCallback(async () => {
    if (!normalized) return;
    try {
      await navigator.clipboard.writeText(normalized);
    } catch {
      // 降级方案：clipboard API 不可用时用临时 textarea
      const textarea = document.createElement("textarea");
      textarea.value = normalized;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [normalized]);

  const containerStyle = {
    position: "fixed",
    top: 16,
    right: 16,
    width: 420,
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    borderRadius: 2,
    boxShadow: theme.shadows[8],
    zIndex: 2147483647,
    overflow: "hidden",
    border: `1px solid ${theme.palette.divider}`,
    fontFamily: theme.typography.fontFamily,
  };

  // Markdown 排版样式：小而清晰的标题、合理的段落/列表间距、引用与行内代码
  const markdownSx = {
    fontSize: "0.9rem",
    color: "text.primary",
    wordBreak: "break-word",
    "& > :first-of-type": { mt: 0 },
    "& > :last-child": { mb: 0 },
    "& h1, & h2, & h3, & h4, & h5, & h6": {
      fontWeight: 700,
      lineHeight: 1.45,
      mt: 1.75,
      mb: 0.75,
      color: "text.primary",
    },
    "& h1": { fontSize: "1.05rem" },
    "& h2": { fontSize: "1rem" },
    "& h3, & h4, & h5, & h6": { fontSize: "0.92rem" },
    "& p": { my: 0.75, lineHeight: 1.7 },
    "& ul, & ol": { pl: 2.5, my: 0.75 },
    "& li": { mb: 0.5, lineHeight: 1.65 },
    "& li::marker": { color: "text.secondary" },
    "& blockquote": {
      m: 0,
      my: 1,
      pl: 1.5,
      borderLeft: "3px solid",
      borderColor: "primary.light",
      color: "text.secondary",
    },
    "& code": {
      px: 0.5,
      py: 0.1,
      borderRadius: 0.5,
      bgcolor: "action.hover",
      fontSize: "0.85em",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    "& pre": {
      p: 1.25,
      my: 1,
      borderRadius: 1,
      bgcolor: "action.hover",
      overflowX: "auto",
      "& code": { p: 0, bgcolor: "transparent" },
    },
    "& a": { color: "primary.main", textDecoration: "none" },
    "& a:hover": { textDecoration: "underline" },
    "& strong": { fontWeight: 700 },
    "& hr": {
      border: 0,
      borderTop: "1px solid",
      borderColor: "divider",
      my: 1.25,
    },
    "& table": { borderCollapse: "collapse", width: "100%", my: 1 },
    "& th, & td": {
      border: `1px solid ${theme.palette.divider}`,
      px: 1,
      py: 0.5,
      textAlign: "left",
    },
  };

  return (
    <Box sx={containerStyle}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.25,
          borderBottom: `1px solid ${theme.palette.divider}`,
          backgroundColor:
            theme.palette.mode === "dark"
              ? theme.palette.action.hover
              : theme.palette.background.default,
          flex: "0 0 auto",
        }}
      >
        <Typography variant="subtitle1" fontWeight={700} noWrap>
          {t("summary_title", "Page Summary")}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="close" edge="end">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ px: 2, py: 2 }}>
          <LinearProgress sx={{ mb: 1.5, borderRadius: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {t("summary_generating", "Generating summary...")}
          </Typography>
        </Box>
      )}

      {/* Error */}
      {error && !loading && (
        <Box sx={{ px: 2, py: 2 }}>
          <Typography variant="body2" color="error" sx={{ lineHeight: 1.6 }}>
            {t("summary_error", "Failed to generate summary")}: {error}
          </Typography>
        </Box>
      )}

      {/* Content */}
      {!loading && !error && normalized && (
        <Box
          sx={{
            flex: 1,
            overflowY: "auto",
            px: 2,
            py: 1.5,
          }}
        >
          <Box component="div" sx={markdownSx}>
            <ReactMarkdown>{normalized}</ReactMarkdown>
          </Box>
        </Box>
      )}

      {/* Empty (无内容且非加载/错误态) */}
      {!loading && !error && !normalized && (
        <Box sx={{ px: 2, py: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t("summary_empty", "No summary content.")}
          </Typography>
        </Box>
      )}

      {/* Footer */}
      {!loading && !error && normalized && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            px: 2,
            py: 1,
            borderTop: `1px solid ${theme.palette.divider}`,
            flex: "0 0 auto",
          }}
        >
          <Button
            size="small"
            color={copied ? "success" : "primary"}
            startIcon={
              copied ? (
                <CheckIcon fontSize="small" />
              ) : (
                <ContentCopyIcon fontSize="small" />
              )
            }
            onClick={handleCopy}
            sx={{ textTransform: "none" }}
          >
            {copied
              ? t("summary_copied", "Copied")
              : t("summary_copy", "Copy Summary")}
          </Button>
        </Box>
      )}
    </Box>
  );
}
