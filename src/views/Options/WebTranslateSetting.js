import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Slider from "@mui/material/Slider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import EditIcon from "@mui/icons-material/Edit";
import { useI18n } from "../../hooks/I18n";
import { useSetting } from "../../hooks/Setting";
import { browser } from "../../libs/browser";

// 快捷键列表（来自 manifest commands）
const SHORTCUT_LIST = [
  { key: "Alt+K", name: "open", i18nKey: "web_translate_shortcut_open" },
  { key: "Alt+Q", name: "toggle", i18nKey: "web_translate_shortcut_toggle" },
  { key: "Alt+S", name: "popup", i18nKey: "web_translate_shortcut_popup" },
  { key: "Alt+C", name: "style", i18nKey: "web_translate_shortcut_style" },
];

// 窗口位置选项
const POSITION_OPTIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
];
const POSITION_I18N = {
  "top-left": "web_translate_position_tl",
  "top-right": "web_translate_position_tr",
  "bottom-left": "web_translate_position_bl",
  "bottom-right": "web_translate_position_br",
  center: "web_translate_position_center",
};

// 窗口大小选项
const SIZE_OPTIONS = ["small", "medium", "large"];
const SIZE_I18N = {
  small: "web_translate_size_small",
  medium: "web_translate_size_medium",
  large: "web_translate_size_large",
};

// 翻译模式选项
const MODE_OPTIONS = ["page", "selection", "hover"];
const MODE_I18N = {
  page: "web_translate_mode_page",
  selection: "web_translate_mode_selection",
  hover: "web_translate_mode_hover",
};

/**
 * 打开浏览器扩展快捷键配置页面
 */
function openShortcutsPage() {
  let url = "chrome://extensions/shortcuts";
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) url = "edge://extensions/shortcuts";
  else if (ua.includes("Firefox/")) url = "about:addons";
  else if (ua.includes("OPR/")) url = "opera://extensions/shortcuts";
  else if (ua.includes("Brave/")) url = "brave://extensions/shortcuts";

  if (browser?.tabs?.create) {
    browser.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

/**
 * 网页翻译设置页面组件
 */
export default function WebTranslateSetting() {
  const i18n = useI18n();
  const { setting, updateSetting } = useSetting();
  const [commands, setCommands] = useState([]);

  // 从 manifest commands 中读取已配置的快捷键
  useEffect(() => {
    if (browser?.commands?.getAll) {
      browser.commands
        .getAll()
        .then((cmds) => {
          if (cmds) setCommands(cmds.filter((c) => c.description));
        })
        .catch((err) => console.error("fetch commands error:", err));
    }
  }, []);

  // 解构网页翻译相关设置（带默认值）
  const {
    webTranslatePosition = "top-right",
    webTranslateSize = "medium",
    webTranslateAutoPopup = false,
    webTranslateOpacity = 95,
    webTranslateMode = "page",
    webTranslateLangFrom = "auto",
    webTranslateLangTo = "zh-CN",
    webTranslateAutoSites = "",
  } = setting;

  // 通用设置变更回调
  const handleChange = (e) => {
    e.preventDefault();
    const { name, value } = e.target;
    updateSetting({ [name]: value });
  };

  // Switch 开关变更回调
  const handleSwitchChange = (name) => (e) => {
    updateSetting({ [name]: e.target.checked });
  };

  // Slider 透明度变更回调
  const handleOpacityChange = (_, newValue) => {
    updateSetting({ webTranslateOpacity: newValue });
  };

  return (
    <Box>
      <Stack spacing={3}>
        {/* 快捷键设置区域 */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {i18n("web_translate_shortcuts")}
            </Typography>

            {/* 已配置的快捷键列表 */}
            <Grid container spacing={2} columns={12} sx={{ mb: 2 }}>
              {commands.length > 0
                ? commands.map((cmd) => (
                    <Grid item xs={12} sm={6} md={4} key={cmd.name}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <TextField
                          size="small"
                          label={cmd.description}
                          value={cmd.shortcut || ""}
                          fullWidth
                          disabled
                        />
                        <IconButton onClick={openShortcutsPage} size="small">
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Grid>
                  ))
                : SHORTCUT_LIST.map((sc) => (
                    <Grid item xs={12} sm={6} md={3} key={sc.name}>
                      <TextField
                        size="small"
                        label={i18n(sc.i18nKey)}
                        value={sc.key}
                        fullWidth
                        disabled
                      />
                    </Grid>
                  ))}
            </Grid>

            {/* 网页总结快捷键（需手动设置） */}
            <Grid container spacing={2} columns={12} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  size="small"
                  label={i18n("web_translate_shortcut_summary")}
                  value={i18n("web_translate_shortcut_manual")}
                  fullWidth
                  disabled
                />
              </Grid>
            </Grid>

            {/* 引导提示 */}
            <Alert severity="info" sx={{ mt: 1 }}>
              {i18n("web_translate_shortcuts_hint")}
            </Alert>
          </CardContent>
        </Card>

        {/* 翻译窗口显示选项 */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {i18n("web_translate_window")}
            </Typography>

            <Grid container spacing={2} columns={12}>
              {/* 窗口位置 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  name="webTranslatePosition"
                  value={webTranslatePosition}
                  label={i18n("web_translate_position")}
                  onChange={handleChange}
                >
                  {POSITION_OPTIONS.map((pos) => (
                    <MenuItem key={pos} value={pos}>
                      {i18n(POSITION_I18N[pos])}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>

              {/* 窗口大小 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  name="webTranslateSize"
                  value={webTranslateSize}
                  label={i18n("web_translate_size")}
                  onChange={handleChange}
                >
                  {SIZE_OPTIONS.map((size) => (
                    <MenuItem key={size} value={size}>
                      {i18n(SIZE_I18N[size])}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>

              {/* 自动弹出翻译窗口 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={webTranslateAutoPopup}
                      onChange={handleSwitchChange("webTranslateAutoPopup")}
                    />
                  }
                  label={i18n("web_translate_auto_popup")}
                />
              </Grid>

              {/* 窗口透明度 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <Typography gutterBottom>
                  {i18n("web_translate_opacity")}: {webTranslateOpacity}%
                </Typography>
                <Slider
                  value={webTranslateOpacity}
                  onChange={handleOpacityChange}
                  min={20}
                  max={100}
                  step={5}
                  valueLabelDisplay="auto"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* 网页翻译行为选项 */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {i18n("web_translate_behavior")}
            </Typography>

            <Grid container spacing={2} columns={12}>
              {/* 默认翻译模式 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  name="webTranslateMode"
                  value={webTranslateMode}
                  label={i18n("web_translate_mode")}
                  onChange={handleChange}
                >
                  {MODE_OPTIONS.map((mode) => (
                    <MenuItem key={mode} value={mode}>
                      {i18n(MODE_I18N[mode])}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>

              {/* 翻译语言对 - 源语言 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  name="webTranslateLangFrom"
                  value={webTranslateLangFrom}
                  label={`${i18n("web_translate_lang_pair")} - From`}
                  onChange={handleChange}
                >
                  <MenuItem value="auto">Auto Detect</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="zh-CN">简体中文</MenuItem>
                  <MenuItem value="zh-TW">繁體中文</MenuItem>
                  <MenuItem value="ja">日本語</MenuItem>
                  <MenuItem value="ko">한국어</MenuItem>
                </TextField>
              </Grid>

              {/* 翻译语言对 - 目标语言 */}
              <Grid item xs={12} sm={12} md={6} lg={3}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  name="webTranslateLangTo"
                  value={webTranslateLangTo}
                  label={`${i18n("web_translate_lang_pair")} - To`}
                  onChange={handleChange}
                >
                  <MenuItem value="zh-CN">简体中文</MenuItem>
                  <MenuItem value="zh-TW">繁體中文</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="ja">日本語</MenuItem>
                  <MenuItem value="ko">한국어</MenuItem>
                </TextField>
              </Grid>
            </Grid>

            {/* 自动翻译特定网站 */}
            <TextField
              size="small"
              label={i18n("web_translate_auto_sites")}
              helperText={i18n("web_translate_auto_sites_hint")}
              name="webTranslateAutoSites"
              value={webTranslateAutoSites}
              onChange={handleChange}
              maxRows={6}
              multiline
              fullWidth
              sx={{ mt: 2 }}
            />
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
