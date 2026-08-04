import { logger } from "../libs/log.js";

/**
 * YouTube 字幕轨道数据层。
 * 只负责识别、选择和拉取 YouTube timedtext/captionTrack 数据，不参与字幕断句、翻译或页面渲染。
 */

/**
 * 简易判断两种语言编码是否属于同一语言大类。
 *
 * @param {string} lang1 第一种语言编码，如 zh-CN。
 * @param {string} lang2 第二种语言编码，如 zh-TW。
 * @returns {boolean} 前两个字符一致时返回 true。
 */
export function isSameLang(lang1, lang2) {
  if (!lang1 || !lang2) return false;
  return lang1.slice(0, 2) === lang2.slice(0, 2);
}

/**
 * 检测字幕轨是否是 Live Chat（弹幕）类型。
 *
 * @param {object|null} track YouTube captionTrack 配置项。
 * @returns {boolean} 是弹幕轨时返回 true。
 */
export function isChatCaptionTrack(track) {
  if (!track) return false;
  const name = track.name?.simpleText || track.name?.runs?.[0]?.text || "";
  return /chat/i.test(name);
}

/**
 * 根据 timedtext URL 查询参数生成字幕轨唯一 Key。
 *
 * @param {URL} potUrl 当前拦截到的 YouTube timedtext 请求 URL。
 * @returns {string} 由视频、语言、轨道类型等字段拼接的轨道标识。
 */
export function buildTrackKey(potUrl) {
  const p = potUrl.searchParams;
  return [
    p.get("v") || "",
    p.get("lang") || "",
    p.get("kind") || "",
    p.get("name") || "",
    p.get("tlang") || "",
  ].join("|");
}

/**
 * 寻找与当前拦截请求最匹配的 YouTube 字幕轨。
 *
 * @param {Array<object>} captionTracks YouTube 页面提供的字幕轨配置列表。
 * @param {string} lang 当前 timedtext 请求的语言编码。
 * @param {string|null} kind 当前 timedtext 请求的轨道类型。
 * @returns {object|null} 匹配到的 captionTrack；无法匹配时返回 null。
 */
export function findCaptionTrack(captionTracks, lang, kind) {
  logger.debug("Youtube Provider: find caption track", {
    captionTracks,
    lang,
    kind,
  });

  if (!captionTracks?.length) {
    return null;
  }

  // 优先匹配用户选择的字幕轨（语言 + kind 完全一致）。
  // 手动字幕没有 kind 字段，统一转成 null，避免 undefined !== null 导致无法匹配。
  let captionTrack = captionTracks.find(
    (item) =>
      item.languageCode === lang && (item.kind || null) === (kind || null)
  );
  if (!captionTrack) {
    captionTrack = captionTracks.find((item) => item.languageCode === lang);
  }
  if (!captionTrack) {
    const asrTrack = captionTracks.find((item) => item.kind === "asr");
    if (asrTrack) {
      captionTrack = captionTracks.find(
        (item) =>
          item.kind !== "asr" &&
          isSameLang(item.languageCode, asrTrack.languageCode)
      );
      if (!captionTrack) {
        captionTrack = asrTrack;
      }
    }
  }

  if (!captionTrack) {
    // REVIEW: 这里沿用原有 pop() 行为。它会修改 captionTracks 数组，
    // 后续若要修复副作用，应单独改为下标读取或克隆数组。
    captionTrack = captionTracks.pop();
  }

  // Chat/弹幕字幕轨道自动降级为正常字幕轨道。
  if (captionTrack && isChatCaptionTrack(captionTrack)) {
    logger.debug(
      "Youtube Provider: detected chat subtitle track, switching to normal subtitle"
    );

    const nonChatSameLang = captionTracks.find(
      (item) => isSameLang(item.languageCode, lang) && !isChatCaptionTrack(item)
    );

    if (nonChatSameLang) {
      logger.debug(
        "Youtube Provider: switched to same-language non-chat track"
      );
      captionTrack = nonChatSameLang;
    } else {
      const anyNonChat = captionTracks.find(
        (item) => !isChatCaptionTrack(item)
      );
      if (anyNonChat) {
        logger.debug("Youtube Provider: switched to fallback non-chat track");
        captionTrack = anyNonChat;
      }
    }
  }

  return captionTrack;
}

/**
 * 请求 YouTube 播放页 HTML，并解析当前视频的字幕轨列表与原始描述。
 *
 * @param {string} videoId 当前视频 ID。
 * @returns {Promise<{captionTracks?: Array<object>, fullDescription?: string}>} 字幕轨配置与视频描述。
 */
export async function getCaptionTracks(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // REVIEW: 每次处理字幕都会重新 fetch 播放页并正则匹配 ytInitialPlayerResponse。
    // 这会造成二次网页下载，也可能在高频使用时被 YouTube 视为异常流量。
    // 后续可优先从当前页面全局对象或客户端内部 API 读取。
    const html = await fetch(url).then((r) => r.text());
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
    if (!match) return {};
    const data = JSON.parse(match[1]);
    return {
      captionTracks:
        data.captions?.playerCaptionsTracklistRenderer?.captionTracks,
      fullDescription: data.videoDetails?.shortDescription || "",
    };
  } catch (err) {
    logger.info("Youtube Provider: get captionTracks", err);
    return {};
  }
}

/**
 * 获取字幕详细事件数组。
 * 当前拦截响应已经是目标原文字幕时直接解析，否则按选中轨道重新请求 JSON3 字幕。
 *
 * @param {URL} capUrl 最终选中的字幕轨 baseUrl。
 * @param {URL} potUrl 当前拦截到的 timedtext 请求 URL。
 * @param {string} responseText 当前拦截请求的响应文本。
 * @returns {Promise<Array<object>|null>} YouTube json3 events 数组。
 */
export async function getSubtitleEvents(capUrl, potUrl, responseText) {
  let interceptedEvents = null;
  try {
    interceptedEvents = JSON.parse(responseText)?.events || null;
  } catch (err) {
    logger.info("Youtube Provider: parse responseText", err);
  }

  const segmentedParams = ["sq", "range", "rn", "rbuf"];
  const isSegmentedResponse = segmentedParams.some((param) =>
    potUrl.searchParams.has(param)
  );
  if (
    !potUrl.searchParams.get("tlang") &&
    !isSegmentedResponse &&
    potUrl.searchParams.get("kind") === capUrl.searchParams.get("kind") &&
    isSameLang(potUrl.searchParams.get("lang"), capUrl.searchParams.get("lang"))
  ) {
    return interceptedEvents;
  }

  try {
    // Start from the complete caption-track URL so track signatures are kept,
    // then merge request-only player tokens from the intercepted URL.
    const requestUrl = new URL(capUrl.href);
    potUrl.searchParams.forEach((value, key) => {
      if (!requestUrl.searchParams.has(key)) {
        requestUrl.searchParams.append(key, value);
      }
    });

    ["tlang", "name", ...segmentedParams].forEach((param) =>
      requestUrl.searchParams.delete(param)
    );
    requestUrl.searchParams.set("lang", capUrl.searchParams.get("lang"));
    requestUrl.searchParams.set("fmt", "json3");
    if (capUrl.searchParams.get("kind")) {
      requestUrl.searchParams.set("kind", capUrl.searchParams.get("kind"));
    } else {
      requestUrl.searchParams.delete("kind");
    }

    const res = await fetch(requestUrl.href);
    if (res?.ok) {
      const json = await res.json();
      return json?.events || interceptedEvents;
    }
    logger.info(`Youtube Provider: Failed to fetch subtitles: ${res.status}`);
    return interceptedEvents;
  } catch (error) {
    logger.info("Youtube Provider: fetching subtitles error", error);
    return interceptedEvents;
  }
}

/**
 * 主动兜底：在“拦截 timedtext 请求未命中”时，直接从字幕轨 baseUrl 拉取 json3 字幕事件。
 * 与依赖拦截的 getSubtitleEvents 不同，本函数不需要拦截到的 potUrl/responseText。
 *
 * @param {object} captionTrack 选定的字幕轨（需含 baseUrl）。
 * @returns {Promise<Array<object>|null>} YouTube json3 events 数组；失败时返回 null。
 */
export async function fetchTrackSubtitleEvents(captionTrack) {
  try {
    let baseUrl = captionTrack?.baseUrl;
    if (!baseUrl) return null;
    if (!baseUrl.startsWith("https")) {
      baseUrl = window.location.origin + baseUrl;
    }
    const url = new URL(baseUrl);
    url.searchParams.set("fmt", "json3");

    const res = await fetch(url.href);
    if (!res?.ok) {
      logger.info(
        `Youtube Provider: proactive fetch subtitles failed: ${res?.status}`
      );
      return null;
    }
    const json = await res.json();
    return json?.events || null;
  } catch (error) {
    logger.info("Youtube Provider: proactive fetch subtitles error", error);
    return null;
  }
}

/**
 * 主动兜底：从视频的字幕轨列表中挑选一条合适的“源语言”字幕轨用于翻译。
 * 优先选择与目标语言不同的手动字幕轨，其次是任意与目标语言不同的轨（含自动生成 asr），
 * 若所有字幕轨都与目标语言相同则返回 null（无需翻译）。
 *
 * @param {Array<object>} captionTracks 视频的字幕轨列表。
 * @param {string} toLang 用户的目标翻译语言代码。
 * @returns {object|null} 选中的源字幕轨；无合适轨道时返回 null。
 */
export function selectProactiveCaptionTrack(captionTracks, toLang) {
  if (!captionTracks?.length) return null;

  const nonChat = captionTracks.filter((track) => !isChatCaptionTrack(track));
  const pool = nonChat.length ? nonChat : captionTracks;

  // 优先：与目标语言不同的手动字幕轨（非 asr 自动字幕）
  const manualDiff = pool.find(
    (track) => track.kind !== "asr" && !isSameLang(track.languageCode, toLang)
  );
  if (manualDiff) return manualDiff;

  // 次选：与目标语言不同的任意字幕轨（含 asr）
  const anyDiff = pool.find((track) => !isSameLang(track.languageCode, toLang));
  if (anyDiff) return anyDiff;

  // 所有字幕轨都与目标语言相同：无需翻译
  return null;
}

/**
 * 根据字幕轨对象生成与 buildTrackKey 一致格式的轨道唯一 Key（用于主动兜底路径）。
 *
 * @param {string} videoId 当前视频 ID。
 * @param {object} track 选中的字幕轨对象。
 * @returns {string} 轨道唯一标识。
 */
export function buildTrackKeyFromTrack(videoId, track) {
  const name = track?.name?.simpleText || track?.name?.runs?.[0]?.text || "";
  return [
    videoId || "",
    track?.languageCode || "",
    track?.kind || "",
    name,
    "",
  ].join("|");
}
