import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { useI18n } from "../../hooks/I18n";
import { useSync } from "../../hooks/Sync";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import LoadingButton from "@mui/lab/LoadingButton";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormHelperText from "@mui/material/FormHelperText";
import InputAdornment from "@mui/material/InputAdornment";
import {
  URL_GITHUB_GIST_TOKEN,
  OPT_SYNCTYPE_ALL,
  OPT_SYNCTYPE_WEBDAV,
  OPT_SYNCTYPE_GIST,
  OPT_SYNCTOKEN_PERFIX,
} from "../../config";
import { useState } from "react";
import {
  changeSyncEncryptKey,
  uploadToCloud,
  downloadFromCloud,
} from "../../libs/sync";
import {
  exportFullConfig,
  importFullConfig,
  downloadConfigAsFile,
  readConfigFromFile,
} from "../../libs/configExport";
import { useAlert } from "../../hooks/Alert";
import { useSetting } from "../../hooks/Setting";
import { kissLog } from "../../libs/log";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

/**
 * 云端备份与同步设置主面板组件 (SyncSetting)
 */
export default function SyncSetting() {
  const i18n = useI18n();
  // 全局同步数据状态 Hook
  const { sync, updateSync } = useSync();
  const alert = useAlert();
  // 数据同步过程中的 Loading 状态
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // 同步加密口令只能通过弹窗设定/修改，避免主表单直接误改导致云端密文不可读。
  const [encryptKeyDialogMode, setEncryptKeyDialogMode] = useState(null);
  const [oldEncryptKey, setOldEncryptKey] = useState("");
  const [newEncryptKey, setNewEncryptKey] = useState("");
  const [confirmEncryptKey, setConfirmEncryptKey] = useState("");
  const [encryptKeyError, setEncryptKeyError] = useState("");
  const [savingEncryptKey, setSavingEncryptKey] = useState(false);
  // 敏感字段默认隐藏，用户可临时切换明文查看。
  const [showSyncKey, setShowSyncKey] = useState(false);
  const [showSyncEncryptKey, setShowSyncEncryptKey] = useState(false);
  const { reloadSetting } = useSetting();

  const getSyncErrorMessage = (err, fallback = i18n("sync_failed")) => {
    const rawMessage = err?.message || String(err || "");
    if (!rawMessage) return fallback;

    try {
      const parsed = JSON.parse(rawMessage);
      const status = parsed.status ? `HTTP ${parsed.status}` : "";
      const statusText = parsed.statusText || "";
      const body = parsed.body ? JSON.stringify(parsed.body) : "";
      const detail = [status, statusText, body].filter(Boolean).join(" ");
      return detail ? `${fallback}: ${detail}` : `${fallback}: ${rawMessage}`;
    } catch {
      return `${fallback}: ${rawMessage}`;
    }
  };

  // 同步配置选项字段更改处理
  const handleChange = async (e) => {
    e.preventDefault();
    const { name, value } = e.target;
    await updateSync({
      [name]: value,
    });
  };

  // 触发物理网络数据上传/下载同步（保留兼容）
  const handleSyncTest = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await uploadToCloud();
      reloadSetting();
      alert.success(i18n("sync_success"));
    } catch (err) {
      kissLog("sync all", err);
      alert.error(getSyncErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // 上传本地数据到云端
  const handleUpload = async () => {
    setUploading(true);
    try {
      await uploadToCloud();
      alert.success(i18n("sync_upload_success"));
    } catch (err) {
      kissLog("upload to cloud", err);
      alert.error(getSyncErrorMessage(err, i18n("sync_upload_failed")));
    } finally {
      setUploading(false);
    }
  };

  // 从云端下载数据覆盖本地
  const handleDownload = async () => {
    const confirmed = window.confirm(i18n("sync_download_confirm"));
    if (!confirmed) return;

    setDownloading(true);
    try {
      await downloadFromCloud();
      alert.success(i18n("sync_download_success"));
      window.location.reload();
    } catch (err) {
      kissLog("download from cloud", err);
      alert.error(getSyncErrorMessage(err, i18n("sync_download_failed")));
    } finally {
      setDownloading(false);
    }
  };

  // 导出完整配置为 JSON 文件
  const handleExport = async () => {
    setExporting(true);
    try {
      const config = await exportFullConfig();
      downloadConfigAsFile(config);
    } catch (err) {
      kissLog("export config", err);
      alert.error(i18n("import_config_failed"));
    } finally {
      setExporting(false);
    }
  };

  // 从 JSON 文件导入配置
  const handleImport = async () => {
    try {
      const config = await readConfigFromFile();
      if (!config) return;

      const confirmed = window.confirm(i18n("import_config_confirm"));
      if (!confirmed) return;

      setImporting(true);
      await importFullConfig(config);
      alert.success(i18n("import_config_success"));
      window.location.reload();
    } catch (err) {
      kissLog("import config", err);
      alert.error(i18n("import_config_failed") + ": " + (err?.message || err));
    } finally {
      setImporting(false);
    }
  };

  // 将当前同步服务的 Url、User、Key 生成一段 Base64 分享口令以支持跨设备一键同步导入
  const handleGenerateShareString = async () => {
    try {
      const base64Config = btoa(
        JSON.stringify({
          syncType: syncType,
          syncUrl: syncUrl,
          syncUser: syncUser,
          syncKey: syncKey,
          syncEncryptKey: syncEncryptKey,
        })
      );
      const shareString = `${OPT_SYNCTOKEN_PERFIX}${base64Config}`;
      await navigator.clipboard.writeText(shareString);
      kissLog("Share string copied to clipboard", shareString);
    } catch (error) {
      kissLog("Failed to copy share string to clipboard", error);
    }
  };

  // 从系统剪贴板中读取分享口令并进行解析，一键恢复同步服务连接
  const handleImportFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      kissLog("read_clipboard", text);
      if (text.startsWith(OPT_SYNCTOKEN_PERFIX)) {
        const base64Config = text.slice(OPT_SYNCTOKEN_PERFIX.length);
        const jsonString = atob(base64Config);
        const updatedConfig = JSON.parse(jsonString);

        // 验证同步服务类型是否合法
        if (!OPT_SYNCTYPE_ALL.includes(updatedConfig.syncType)) {
          kissLog("error syncType", updatedConfig.syncType);
          return;
        }

        if (
          updatedConfig.syncUrl ||
          updatedConfig.syncType === OPT_SYNCTYPE_GIST
        ) {
          updateSync({
            syncType: updatedConfig.syncType,
            syncUrl: updatedConfig.syncUrl,
            syncUser: updatedConfig.syncUser,
            syncKey: updatedConfig.syncKey,
            syncEncryptKey: updatedConfig.syncEncryptKey || "",
          });
        } else {
          kissLog("Invalid config structure");
        }
      } else {
        kissLog("Invalid share string", text);
      }
    } catch (error) {
      kissLog("Failed to read from clipboard or parse JSON", error);
    }
  };

  const openEncryptKeyDialog = (mode) => {
    setEncryptKeyDialogMode(mode);
    setOldEncryptKey("");
    setNewEncryptKey("");
    setConfirmEncryptKey("");
    setEncryptKeyError("");
  };

  const closeEncryptKeyDialog = () => {
    if (savingEncryptKey) return;
    setEncryptKeyDialogMode(null);
    setEncryptKeyError("");
  };

  // 设定口令只保存本地配置；修改口令需要先完成远端数据重加密。
  const handleSaveEncryptKey = async () => {
    setEncryptKeyError("");

    if (newEncryptKey.length < 6) {
      setEncryptKeyError(i18n("sync_encrypt_key_too_short"));
      return;
    }

    if (newEncryptKey !== confirmEncryptKey) {
      setEncryptKeyError(i18n("sync_encrypt_key_mismatch"));
      return;
    }

    if (encryptKeyDialogMode === "change" && oldEncryptKey !== syncEncryptKey) {
      setEncryptKeyError(i18n("old_sync_encrypt_key_invalid"));
      return;
    }

    try {
      setSavingEncryptKey(true);
      if (encryptKeyDialogMode === "change") {
        await changeSyncEncryptKey(newEncryptKey);
      }
      await updateSync({ syncEncryptKey: newEncryptKey });
      setEncryptKeyDialogMode(null);
      alert.success(i18n("sync_success"));
    } catch (err) {
      kissLog("save sync encrypt key", err);
      setEncryptKeyError(
        getSyncErrorMessage(
          err,
          encryptKeyDialogMode === "change"
            ? i18n("sync_encrypt_key_change_failed")
            : i18n("sync_failed")
        )
      );
    } finally {
      setSavingEncryptKey(false);
    }
  };

  if (!sync) {
    return null;
  }

  const {
    syncType = OPT_SYNCTYPE_WEBDAV,
    syncUrl = "",
    syncUser = "",
    syncKey = "",
    syncEncryptKey = "",
  } = sync;
  const isGistSync = syncType === OPT_SYNCTYPE_GIST;

  return (
    <Box>
      <Stack spacing={3}>
        {/* 数据同步的风险警告与备份注意事项提示 */}
        <Alert severity="info">{i18n("sync_warn_encryption")}</Alert>
        <Alert severity="warning">{i18n("sync_warn")}</Alert>
        <Alert severity="warning">{i18n("sync_warn_2")}</Alert>
        {isGistSync && (
          <Alert severity="warning">{i18n("sync_warn_gist")}</Alert>
        )}

        {/* 同步通道类型 (WebDAV 或 Gist) */}
        <TextField
          select
          size="small"
          name="syncType"
          value={syncType}
          label={i18n("data_sync_type")}
          onChange={handleChange}
          helperText={
            isGistSync && (
              <Link href={URL_GITHUB_GIST_TOKEN} target="_blank">
                {i18n("gist_sync_tip")}
              </Link>
            )
          }
        >
          {OPT_SYNCTYPE_ALL.map((item) => (
            <MenuItem key={item} value={item}>
              {item}
            </MenuItem>
          ))}
        </TextField>

        {/* 同步接口 URL 终端地址 */}
        {!isGistSync && (
          <TextField
            size="small"
            label={i18n("data_sync_url")}
            name="syncUrl"
            value={syncUrl}
            onChange={handleChange}
          />
        )}

        {/* 仅在 WebDAV 模式下显示的用户名输入框 */}
        {syncType === OPT_SYNCTYPE_WEBDAV && (
          <TextField
            size="small"
            label={i18n("data_sync_user")}
            name="syncUser"
            value={syncUser}
            onChange={handleChange}
          />
        )}

        {/* 云端数据访问密码或同步密钥 */}
        <TextField
          size="small"
          type={showSyncKey ? "text" : "password"}
          label={i18n("data_sync_key")}
          name="syncKey"
          value={syncKey}
          onChange={handleChange}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  edge="end"
                  onClick={() => setShowSyncKey((value) => !value)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {showSyncKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        {/* 只读展示同步加密口令，实际设定/修改统一进入弹窗处理。 */}
        <Box>
          <Stack direction="row" alignItems="center" spacing={2}>
            <TextField
              fullWidth
              size="small"
              type={showSyncEncryptKey ? "text" : "password"}
              label={i18n("data_sync_encrypt_key")}
              name="syncEncryptKey"
              value={syncEncryptKey}
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      edge="end"
                      onClick={() => setShowSyncEncryptKey((value) => !value)}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {showSyncEncryptKey ? (
                        <VisibilityOffIcon />
                      ) : (
                        <VisibilityIcon />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <IconButton
              size="small"
              aria-label={i18n("data_sync_encrypt_key")}
              sx={{ flexShrink: 0 }}
              onClick={() =>
                openEncryptKeyDialog(syncEncryptKey ? "change" : "set")
              }
            >
              <EditIcon />
            </IconButton>
          </Stack>
          {!syncEncryptKey && (
            <FormHelperText error>
              {i18n("sync_encrypt_key_not_set")}
            </FormHelperText>
          )}
        </Box>

        {/* 控制按钮栏：包含上传/下载、复制/粘贴同步口令 */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={2}
          useFlexGap
          flexWrap="wrap"
        >
          {/* 上传本地数据到云端 */}
          <LoadingButton
            size="small"
            variant="contained"
            disabled={
              (!isGistSync && !syncUrl) ||
              !syncKey ||
              !syncEncryptKey ||
              uploading
            }
            onClick={handleUpload}
            startIcon={<CloudUploadIcon />}
            loading={uploading}
          >
            {i18n("sync_upload_cloud")}
          </LoadingButton>
          {/* 从云端下载数据到本地 */}
          <LoadingButton
            size="small"
            variant="outlined"
            disabled={
              (!isGistSync && !syncUrl) ||
              !syncKey ||
              !syncEncryptKey ||
              downloading
            }
            onClick={handleDownload}
            startIcon={<CloudDownloadIcon />}
            loading={downloading}
          >
            {i18n("sync_download_cloud")}
          </LoadingButton>
          {/* 生成同步分享码并拷贝到剪贴板 */}
          <Button
            size="small"
            variant="outlined"
            onClick={handleGenerateShareString}
            startIcon={<ContentCopyIcon />}
          >
            {i18n("copy", "copy")}
          </Button>
          {/* 从剪贴板读取同步码一键连接 */}
          <Button
            onClick={handleImportFromClipboard}
            size="small"
            variant="outlined"
            startIcon={<ContentPasteIcon />}
          >
            {i18n("import", "import")}
          </Button>
        </Stack>

        {/* 本地配置导入/导出 */}
        <Divider />
        <Typography variant="subtitle1">{i18n("local_config")}</Typography>
        <Stack
          direction="row"
          alignItems="center"
          spacing={2}
          useFlexGap
          flexWrap="wrap"
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={handleExport}
            disabled={exporting}
          >
            {i18n("export_config")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileUploadIcon />}
            onClick={handleImport}
            disabled={importing}
          >
            {i18n("import_config")}
          </Button>
        </Stack>
        <Alert severity="info">{i18n("export_config_tip")}</Alert>
      </Stack>
      <Dialog open={!!encryptKeyDialogMode} onClose={closeEncryptKeyDialog}>
        <DialogTitle>
          {encryptKeyDialogMode === "change"
            ? i18n("change_sync_encrypt_key")
            : i18n("set_sync_encrypt_key")}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1, minWidth: 360 }}>
            {encryptKeyDialogMode === "change" && (
              <TextField
                size="small"
                type="password"
                label={i18n("old_sync_encrypt_key")}
                value={oldEncryptKey}
                onChange={(e) => setOldEncryptKey(e.target.value)}
              />
            )}
            <TextField
              size="small"
              type="password"
              label={i18n("new_sync_encrypt_key")}
              value={newEncryptKey}
              onChange={(e) => setNewEncryptKey(e.target.value)}
            />
            <TextField
              size="small"
              type="password"
              label={i18n("confirm_sync_encrypt_key")}
              value={confirmEncryptKey}
              onChange={(e) => setConfirmEncryptKey(e.target.value)}
              error={!!encryptKeyError}
              helperText={encryptKeyError}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEncryptKeyDialog} disabled={savingEncryptKey}>
            {i18n("cancel", "cancel")}
          </Button>
          <LoadingButton
            onClick={handleSaveEncryptKey}
            loading={savingEncryptKey}
            variant="contained"
          >
            {i18n("save", "save")}
          </LoadingButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
