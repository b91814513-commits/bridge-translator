import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Grid from "@mui/material/Grid";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import { useMemo } from "react";
import { useI18n } from "../../hooks/I18n";
import { useWebSummary } from "../../hooks/WebSummary";
import { useApiList } from "../../hooks/Api";
import { usePromptList } from "../../hooks/Prompt";
import {
  OPT_LANGS_TO,
  PROMPT_MODE_FOLLOW_API,
  PROMPT_MODE_GLOBAL,
  getSummaryPromptOptions,
  getPromptDisplayName,
} from "../../config";

/**
 * 网页总结设置页面组件
 */
export default function WebSummarySetting() {
  const i18n = useI18n();
  // 网页总结设置 Hook
  const { webSummarySetting, updateWebSummary } = useWebSummary();
  // 启用的 AI 引擎列表
  const { aiEnabledApis } = useApiList();
  const { prompts } = usePromptList();
  // 仅展示网页总结分类提示词
  const summaryPromptOptions = useMemo(
    () => getSummaryPromptOptions(prompts),
    [prompts]
  );

  // 通用表单变动提交
  const handleChange = (e) => {
    e.preventDefault();
    const { name, value } = e.target;
    updateWebSummary({ [name]: value });
  };

  // 解构当前网页总结的具体设置
  const {
    enabled,
    apiSlug = "-",
    promptMode = PROMPT_MODE_FOLLOW_API,
    promptSlug,
    toLang = "zh-CN",
  } = webSummarySetting;

  const hasSelectedPrompt = summaryPromptOptions.some(
    (prompt) => prompt.slug === promptSlug
  );
  const promptValue =
    promptMode === PROMPT_MODE_GLOBAL && hasSelectedPrompt
      ? promptSlug
      : PROMPT_MODE_FOLLOW_API;

  // 总结提示词变更回调
  const handlePromptChange = (e) => {
    e.preventDefault();
    const { value } = e.target;

    if (value === PROMPT_MODE_FOLLOW_API) {
      updateWebSummary({
        promptMode: PROMPT_MODE_FOLLOW_API,
      });
      return;
    }

    updateWebSummary({
      promptMode: PROMPT_MODE_GLOBAL,
      promptSlug: value,
    });
  };

  return (
    <Box>
      <Stack spacing={3}>
        {/* 开关：是否启用网页总结功能 */}
        <FormControlLabel
          control={
            <Switch
              size="small"
              name="enabled"
              checked={enabled}
              onChange={() => {
                updateWebSummary({ enabled: !enabled });
              }}
            />
          }
          label={i18n("toggle_web_summary")}
          sx={{ width: "fit-content" }}
        />

        {/* 网页总结各项参数配置网格区域 */}
        <Box>
          <Grid container spacing={2} columns={12}>
            {/* 总结所用 AI 接口 */}
            <Grid item xs={12} sm={12} md={6} lg={3}>
              <TextField
                select
                fullWidth
                size="small"
                name="apiSlug"
                value={apiSlug}
                label={i18n("translate_service")}
                onChange={handleChange}
              >
                <MenuItem value="-">{i18n("web_summary_auto_api")}</MenuItem>
                {aiEnabledApis.map((api) => (
                  <MenuItem key={api.apiSlug} value={api.apiSlug}>
                    {api.apiName}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            {/* 总结提示词 */}
            <Grid item xs={12} sm={12} md={6} lg={3}>
              <TextField
                select
                fullWidth
                size="small"
                name="promptSlug"
                value={promptValue}
                label={i18n("web_summary_prompt")}
                onChange={handlePromptChange}
              >
                <MenuItem value={PROMPT_MODE_FOLLOW_API}>
                  {i18n("follow_api_prompt", "接口默认")}
                </MenuItem>
                {summaryPromptOptions.map((prompt) => (
                  <MenuItem key={prompt.slug} value={prompt.slug}>
                    {getPromptDisplayName(prompt, i18n)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            {/* 目标语言 */}
            <Grid item xs={12} sm={12} md={6} lg={3}>
              <TextField
                fullWidth
                select
                size="small"
                name="toLang"
                value={toLang}
                label={i18n("to_lang")}
                onChange={handleChange}
              >
                {OPT_LANGS_TO.map(([lang, name]) => (
                  <MenuItem key={lang} value={lang}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </Box>
      </Stack>
    </Box>
  );
}