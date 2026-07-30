import {
  getSetting,
  getRules,
  getWords,
  getSync,
  setSetting,
  setRules,
  setWords,
  setSync,
} from "./storage";

const EXPORT_VERSION = 1;

/**
 * 从设置对象中剔除敏感字段（API 密钥等），返回深拷贝。
 */
const sanitizeSetting = (setting) => {
  if (!setting) return setting;
  const cloned = JSON.parse(JSON.stringify(setting));
  // 剔除每个翻译 API 配置中的密钥字段
  if (Array.isArray(cloned.transApis)) {
    cloned.transApis = cloned.transApis.map((api) => {
      if (api && api.key) {
        return { ...api, key: "" };
      }
      return api;
    });
  }
  return cloned;
};

/**
 * 从同步配置中剔除敏感字段，返回深拷贝。
 */
const sanitizeSync = (sync) => {
  if (!sync) return sync;
  const cloned = JSON.parse(JSON.stringify(sync));
  // 剔除同步密钥、加密口令及设备特定的同步元数据
  delete cloned.syncKey;
  delete cloned.syncEncryptKey;
  delete cloned.syncMeta;
  return cloned;
};

/**
 * 导出完整配置为 JSON 对象
 * 包含设置、规则、生词本、同步配置（不含 API 密钥等敏感信息）
 */
export async function exportFullConfig() {
  const [setting, rules, words, sync] = await Promise.all([
    getSetting(),
    getRules(),
    getWords(),
    getSync(),
  ]);

  return {
    exportVersion: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    appName: "Bridge Translator",
    data: {
      setting: sanitizeSetting(setting),
      rules,
      words,
      sync: sanitizeSync(sync),
    },
  };
}

/**
 * 从 JSON 对象导入配置
 * 验证格式后写入本地存储
 */
export async function importFullConfig(configData) {
  // 验证配置格式
  if (!configData || !configData.data) {
    throw new Error("Invalid config format");
  }

  const { setting, rules, words, sync } = configData.data;

  // 写入本地存储
  const promises = [];
  if (setting) promises.push(setSetting(setting));
  if (rules) promises.push(setRules(rules));
  if (words) promises.push(setWords(words));
  if (sync) promises.push(setSync(sync));

  await Promise.all(promises);
}

/**
 * 触发浏览器下载 JSON 文件
 */
export function downloadConfigAsFile(config) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bridge-translator-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 读取用户选择的 JSON 文件
 */
export function readConfigFromFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        const config = JSON.parse(text);
        resolve(config);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
