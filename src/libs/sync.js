import {
  APP_LCNAME,
  KV_SETTING_KEY,
  KV_RULES_KEY,
  KV_WORDS_KEY,
  KV_RULES_SHARE_KEY,
  OPT_SYNCTYPE_WEBDAV,
  OPT_SYNCTYPE_GIST,
} from "../config";
import {
  getSyncWithDefault,
  putSync,
  getSettingWithDefault,
  getRulesWithDefault,
  getWordsWithDefault,
  setSetting,
  setRules,
  setWords,
} from "./storage";
import {
  apiCreateGist,
  apiListGists,
  apiGetGist,
  apiUpdateGistFile,
  apiFetchText,
} from "../apis";
import { removeEndchar } from "./utils";
import { createClient, getPatcher } from "webdav";
import { fetchPatcher } from "./fetch";
import { kissLog } from "./log";
import { encryptSyncValue, decryptSyncValue } from "./syncCrypto";

let webdavRequestPatched = false;
const GIST_SYNC_DESCRIPTION = "kiss translator sync files";

/**
 * 确保 WebDAV 库的 request 通道只被补丁一次。
 *
 * @returns {void}
 */
const ensureWebdavRequestPatched = () => {
  if (webdavRequestPatched) return;
  webdavRequestPatched = true;

  // WebDAV 同步只在实际使用前安装补丁，避免模块导入时产生隐式全局副作用。
  getPatcher().patch("request", (opts) => {
    return fetchPatcher(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.data,
    });
  });
};

/**
 * 使用 WebDAV 同步规则或设置数据。
 * @param {Object} data 待同步的数据结构
 * @param {string} data.key 数据保存的唯一键值名 (如 setting/rules)
 * @param {string} data.value 数据序列化后的字符串
 * @param {number} data.updateAt 本地最后更新时间戳
 * @param {Object} params WebDAV 连接参数
 * @param {string} params.syncUrl 云端 WebDAV 地址
 * @param {string} params.syncUser 账号用户名
 * @param {string} params.syncKey 账号密码或应用授权码
 * @returns {Promise<Object>} 返回最终云端与本地同步判定后的最新数据对象
 */
const syncByWebdav = async (
  data,
  { syncUrl, syncUser, syncKey },
  { forceWrite = false } = {}
) => {
  ensureWebdavRequestPatched();

  const client = createClient(syncUrl, {
    username: syncUser,
    password: syncKey,
  });
  const pathname = `/${APP_LCNAME}`;
  const filename = `/${APP_LCNAME}/${data.key}`;

  // 1. 若云端应用根目录不存在，则创建对应文件夹
  if ((await client.exists(pathname)) === false) {
    await client.createDirectory(pathname);
  }

  // 2. 若云端文件已存在，则读取云端内容，对比 updateAt 时间戳以决定“谁覆盖谁”
  const isExist = await client.exists(filename);
  if (isExist && !forceWrite) {
    const cont = await client.getFileContents(filename, { format: "text" });
    const webData = JSON.parse(cont);

    // REVIEW: 纯时间戳机制。若云端数据版本更新或与本地一致，则放弃本地上传，返回云端数据以更新本地
    if (webData.updateAt >= data.updateAt) {
      return webData;
    }
  }

  // 3. 若云端没有该文件或本地数据更新，则把本地最新数据上传覆盖云端文件
  await client.putFileContents(filename, JSON.stringify(data, null, 2));
  return data;
};

export const getGistId = (input = "") => {
  const value = input.trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return value;
  }
};

const findGistByDescription = async (syncKey) => {
  const gists = await apiListGists(syncKey);
  return gists
    .filter((gist) => gist.description === GIST_SYNC_DESCRIPTION)
    .sort((a, b) => {
      const timeA = Date.parse(a.updated_at || a.created_at || 0);
      const timeB = Date.parse(b.updated_at || b.created_at || 0);
      return timeB - timeA;
    })[0];
};

const getGistFilename = (key) => {
  if (key.startsWith("bridge-rules_")) return `sync-rules_${key}`;
  if (key === KV_WORDS_KEY) return `sync-words_${key}`;
  return key;
};

const syncByGist = async (
  data,
  { syncUrl, syncKey },
  { forceWrite = false } = {}
) => {
  let gistId = getGistId(syncUrl);
  const filename = getGistFilename(data.key);
  const content = JSON.stringify(data, null, 2);

  if (!gistId) {
    const existingGist = await findGistByDescription(syncKey);
    if (existingGist?.id) {
      gistId = existingGist.id;
      await putSync({ syncUrl: gistId });
    }
  }

  if (!gistId) {
    const gist = await apiCreateGist(
      syncKey,
      {
        key: filename,
        content,
      },
      GIST_SYNC_DESCRIPTION
    );
    await putSync({ syncUrl: gist.id });
    return data;
  }

  const gist = await apiGetGist(gistId, syncKey);
  const file = gist.files?.[filename] || gist.files?.[data.key];
  if (file && !forceWrite) {
    const fileContent = file.content || (await apiFetchText(file.raw_url));
    const gistData = JSON.parse(fileContent);
    if (gistData.updateAt >= data.updateAt) {
      return gistData;
    }
  }

  await apiUpdateGistFile(gistId, syncKey, filename, content);
  return data;
};

/**
 * 将同步包的业务 value 加密，保留 key/updateAt 用于远端文件定位与冲突判断。
 * @param {Object} data 同步包
 * @param {string} syncEncryptKey 同步加密口令
 * @returns {Promise<Object>}
 */
const encryptSyncData = async (data, syncEncryptKey) => ({
  ...data,
  value: await encryptSyncValue(data.value, syncEncryptKey),
});

/**
 * 解密同步包中的 value，并保留是否来自新版密文的标记。
 * @param {Object} data 远端返回的同步包
 * @param {string} syncEncryptKey 同步加密口令
 * @returns {Promise<{data: Object, encrypted: boolean}>}
 */
const decryptSyncData = async (data, syncEncryptKey) => {
  const { value, encrypted } = await decryptSyncValue(
    data.value,
    syncEncryptKey
  );
  return {
    data: {
      ...data,
      value,
    },
    encrypted,
  };
};

/**
 * 按同步类型分发到 WebDAV / Gist。
 * options.forceWrite 只用于 WebDAV/Gist 客户端侧跳过远端时间戳比较。
 */
const syncByType = async (syncType, data, args, options) =>
  syncType === OPT_SYNCTYPE_WEBDAV
    ? await syncByWebdav(data, args, options)
    : await syncByGist(data, args, options);

/**
 * 将已经读取成功的旧版明文远端数据，用当前同步加密口令回写成密文。
 */
const migratePlainSyncData = async (syncType, data, args, syncEncryptKey) => {
  const encryptedData = await encryptSyncData(data, syncEncryptKey);
  await syncByType(syncType, encryptedData, args, { forceWrite: true });
};

/**
 * 修改同步加密口令时强制用指定口令回写某一类个人同步数据。
 *
 * @param {string} key 同步文件键名
 * @param {*} value 当前本地业务数据
 * @param {string} syncEncryptKey 新同步加密口令
 * @returns {Promise<void>}
 */
const forceSyncDataWithEncryptKey = async (key, value, syncEncryptKey) => {
  const {
    syncType,
    syncUrl,
    syncUser,
    syncKey,
    syncMeta = {},
  } = await getSyncWithDefault();

  if (
    !syncKey ||
    !syncEncryptKey ||
    (syncType !== OPT_SYNCTYPE_GIST && !syncUrl) ||
    (syncType === OPT_SYNCTYPE_WEBDAV && !syncUser)
  ) {
    throw new Error("sync setting is incomplete");
  }

  // 口令轮换会改变密文内容，必须提升 updateAt 让其他设备感知新版本。
  const updateAt = Date.now();
  const args = {
    syncUrl,
    syncUser,
    syncKey,
  };
  const data = await encryptSyncData(
    {
      key,
      value: JSON.stringify(value),
      updateAt,
    },
    syncEncryptKey
  );

  const res = await syncByType(syncType, data, args, { forceWrite: true });
  if (!res) {
    throw new Error("sync data got err", key);
  }

  syncMeta[key] = {
    updateAt,
    syncAt: Date.now(),
  };
  await putSync({ syncMeta });
};

/**
 * 核心同步调度器。根据配置的 syncType（WebDAV / Worker）执行对应的网络同步，
 * 并依据“最新修改时间戳”双向更新本地 Storage 与云端。
 * @param {string} key 存储键值 (如 KV_SETTING_KEY, KV_RULES_KEY)
 * @param {*} value 本地最新的状态数据值
 * @returns {Promise<{value: *, isNew: boolean}|undefined>}
 *          value: 最终判定采用的最新数据值，isNew: 标识该数据是否比本地之前的数据新
 */
export const syncData = async (key, value) => {
  // 获取同步服务配置
  const {
    syncType,
    syncUrl,
    syncUser,
    syncKey,
    syncEncryptKey,
    syncMeta = {},
  } = await getSyncWithDefault();

  // 若未填写必要的同步参数，则直接退出不报错
  if (
    !syncKey ||
    !syncEncryptKey ||
    (syncType !== OPT_SYNCTYPE_GIST && !syncUrl) ||
    (syncType === OPT_SYNCTYPE_WEBDAV && !syncUser)
  ) {
    return;
  }

  let { updateAt = 0, syncAt = 0 } = syncMeta[key] || {};
  if (syncAt === 0) {
    updateAt = 0; // 若从未同步过，将更新时间置 0 以触发首次拉取云端
  }

  const data = {
    key,
    value: JSON.stringify(value),
    updateAt,
  };
  const args = {
    syncUrl,
    syncUser,
    syncKey,
  };

  const encryptedData = await encryptSyncData(data, syncEncryptKey);

  // 根据同步类型执行不同的同步方法
  const encryptedOrLegacyRes = await syncByType(syncType, encryptedData, args);

  if (!encryptedOrLegacyRes) {
    throw new Error("sync data got err", key);
  }

  const { data: res, encrypted } = await decryptSyncData(
    encryptedOrLegacyRes,
    syncEncryptKey
  );
  const newVal = JSON.parse(res.value);
  // 若返回的云端数据更新时间戳晚于本地，则说明云端有新更改需要覆盖本地
  const isNew = res.updateAt > updateAt;

  // 新版客户端首次遇到旧版明文远端数据时，读取后立即迁移为密文。
  if (!encrypted) {
    await migratePlainSyncData(syncType, res, args, syncEncryptKey);
  }

  // 更新本地同步元数据，包含云端的最新修改时间及当前的同步操作时间
  syncMeta[key] = {
    updateAt: res.updateAt,
    syncAt: Date.now(),
  };
  await putSync({ syncMeta });

  return { value: newVal, isNew };
};

/**
 * 同步用户设置 (Setting)。若云端设置更新，则覆盖本地设置。
 */
const syncSetting = async () => {
  const value = await getSettingWithDefault();
  const res = await syncData(KV_SETTING_KEY, value);
  if (res?.isNew) {
    await setSetting(res.value);
  }
};

/**
 * 包装错误捕获的设置同步入口，避免网络错误阻断其他逻辑。
 */
export const trySyncSetting = async () => {
  try {
    await syncSetting();
  } catch (err) {
    kissLog("sync setting", err.message);
  }
};

/**
 * 同步规则 (Rules)。若云端规则更新，则覆盖本地规则。
 */
const syncRules = async () => {
  const value = await getRulesWithDefault();
  const res = await syncData(KV_RULES_KEY, value);
  if (res?.isNew) {
    await setRules(res.value);
  }
};

/**
 * 包装错误捕获的规则同步入口。
 */
export const trySyncRules = async () => {
  try {
    await syncRules();
  } catch (err) {
    kissLog("sync user rules", err.message);
  }
};

/**
 * 同步生词本词汇 (Fav Words)。若云端有更新，则覆盖本地。
 */
const syncWords = async () => {
  const value = await getWordsWithDefault();
  const res = await syncData(KV_WORDS_KEY, value);
  if (res?.isNew) {
    await setWords(res.value);
  }
};

/**
 * 包装错误捕获的生词本同步入口。
 */
export const trySyncWords = async () => {
  try {
    await syncWords();
  } catch (err) {
    kissLog("sync fav words", err.message);
  }
};

/**
 * 同步并公开分享当前规则。
 * 将用户的规则上传至 WebDAV 或 Gist 同步渠道，并生成分享链接。
 * @param {Object} params
 * @param {Array<Object>} params.rules 待分享的规则数组
 * @param {string} params.syncType 同步类型 (WebDAV / GitHub Gist)
 * @param {string} params.syncUrl 同步服务端点或 Gist ID
 * @param {string} params.syncKey 校验密钥或 Gist Token
 * @returns {Promise<string>} 返回生成的规则订阅分享 URL
 */
export const syncShareRules = async ({ rules, syncType, syncUrl, syncKey }) => {
  const data = {
    key: KV_RULES_SHARE_KEY,
    value: JSON.stringify(rules, null, 2),
    updateAt: Date.now(),
  };
  const args = {
    syncUrl,
    syncUser: "",
    syncKey,
  };

  await syncByType(syncType, data, args, { forceWrite: true });

  if (syncType === OPT_SYNCTYPE_GIST) {
    const gistId = getGistId(syncUrl);
    return `https://gist.github.com/${gistId}`;
  }

  // WebDAV: 基于 syncUrl 构造分享文件路径
  const baseUrl = removeEndchar(syncUrl, "/");
  return `${baseUrl}/${APP_LCNAME}/${KV_RULES_SHARE_KEY}`;
};

/**
 * 顺序同步个人设置、自定义规则以及生词本。
 */
export const syncSettingAndRules = async () => {
  await syncSetting();
  await syncRules();
  await syncWords();
};

/**
 * 修改同步加密口令，并用新口令重新加密个人同步数据。
 *
 * 先用旧口令完成一次普通同步，确保本地拿到远端最新数据；三类数据全部
 * 用新口令回写成功后，才保存新的 syncEncryptKey，避免半失败导致旧密文不可读。
 * @param {string} newSyncEncryptKey 新同步加密口令
 * @returns {Promise<void>}
 */
export const changeSyncEncryptKey = async (newSyncEncryptKey) => {
  await syncSettingAndRules();

  await forceSyncDataWithEncryptKey(
    KV_SETTING_KEY,
    await getSettingWithDefault(),
    newSyncEncryptKey
  );
  await forceSyncDataWithEncryptKey(
    KV_RULES_KEY,
    await getRulesWithDefault(),
    newSyncEncryptKey
  );
  await forceSyncDataWithEncryptKey(
    KV_WORDS_KEY,
    await getWordsWithDefault(),
    newSyncEncryptKey
  );

  await putSync({ syncEncryptKey: newSyncEncryptKey });
};

/**
 * 包装错误捕获的完整同步链入口。
 */
export const trySyncSettingAndRules = async () => {
  await trySyncSetting();
  await trySyncRules();
  await trySyncWords();
};

/**
 * 上传本地数据到云端
 * 将本地设置、规则、生词本强制上传覆盖云端数据
 * @param {Object} [syncConfig] 可选的同步配置覆盖，未提供时从存储中读取
 * @returns {Promise<void>}
 */
export const uploadToCloud = async (syncConfig) => {
  const {
    syncType,
    syncUrl,
    syncUser,
    syncKey,
    syncEncryptKey,
    syncMeta = {},
  } = syncConfig || (await getSyncWithDefault());

  if (
    !syncKey ||
    !syncEncryptKey ||
    (syncType !== OPT_SYNCTYPE_GIST && !syncUrl) ||
    (syncType === OPT_SYNCTYPE_WEBDAV && !syncUser)
  ) {
    throw new Error("sync setting is incomplete");
  }

  const args = { syncUrl, syncUser, syncKey };
  const updateAt = Date.now();
  const keys = [KV_SETTING_KEY, KV_RULES_KEY, KV_WORDS_KEY];
  const getters = [getSettingWithDefault, getRulesWithDefault, getWordsWithDefault];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = await getters[i]();
    const data = {
      key,
      value: JSON.stringify(value),
      updateAt,
    };
    const encryptedData = await encryptSyncData(data, syncEncryptKey);
    const res = await syncByType(syncType, encryptedData, args, {
      forceWrite: true,
    });
    if (!res) {
      throw new Error("sync data got err", key);
    }
    syncMeta[key] = { updateAt, syncAt: Date.now() };
  }

  await putSync({ syncMeta });
};

/**
 * 从云端下载数据到本地
 * 从云端下载数据覆盖本地设置、规则、生词本
 * @param {Object} [syncConfig] 可选的同步配置覆盖，未提供时从存储中读取
 * @returns {Promise<void>}
 */
export const downloadFromCloud = async (syncConfig) => {
  const {
    syncType,
    syncUrl,
    syncUser,
    syncKey,
    syncEncryptKey,
    syncMeta = {},
  } = syncConfig || (await getSyncWithDefault());

  if (
    !syncKey ||
    !syncEncryptKey ||
    (syncType !== OPT_SYNCTYPE_GIST && !syncUrl) ||
    (syncType === OPT_SYNCTYPE_WEBDAV && !syncUser)
  ) {
    throw new Error("sync setting is incomplete");
  }

  const args = { syncUrl, syncUser, syncKey };
  // 使用 updateAt=0 确保云端数据始终被视为"更新"，从而覆盖本地
  const updateAt = 0;
  const keys = [KV_SETTING_KEY, KV_RULES_KEY, KV_WORDS_KEY];
  const setters = [setSetting, setRules, setWords];
  const getters = [getSettingWithDefault, getRulesWithDefault, getWordsWithDefault];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const localValue = await getters[i]();
    const data = {
      key,
      value: JSON.stringify(localValue),
      updateAt,
    };
    const encryptedData = await encryptSyncData(data, syncEncryptKey);
    const encryptedOrLegacyRes = await syncByType(
      syncType,
      encryptedData,
      args
    );
    if (!encryptedOrLegacyRes) {
      throw new Error("sync data got err", key);
    }
    const { data: res, encrypted } = await decryptSyncData(
      encryptedOrLegacyRes,
      syncEncryptKey
    );
    const cloudVal = JSON.parse(res.value);

    // 新版客户端首次遇到旧版明文远端数据时，迁移为密文
    if (!encrypted) {
      await migratePlainSyncData(syncType, res, args, syncEncryptKey);
    }

    // 始终用云端数据覆盖本地
    await setters[i](cloudVal);
    syncMeta[key] = {
      updateAt: res.updateAt,
      syncAt: Date.now(),
    };
  }

  await putSync({ syncMeta });
};

/**
 * @deprecated 请使用 uploadToCloud / downloadFromCloud 替代
 * 顺序同步个人设置、自定义规则以及生词本（双向同步）。
 */
export const syncMeta = syncSettingAndRules;
