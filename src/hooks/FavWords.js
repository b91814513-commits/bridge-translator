import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearFavoriteWords,
  getFavoriteWords,
  mergeFavoriteWords,
  normalizeWordKey,
  removeFavoriteWord,
  subscribeFavoriteWords,
  toggleUngroupedFavorite,
} from "../libs/favWords";

const DEFAULT_FAVWORDS = {};

/**
 * 生词本管理的自定义 Hook，支持生词的收藏、取消收藏、批量合并与清空
 */
export function useFavWords() {
  const [favWords, setFavWords] = useState(DEFAULT_FAVWORDS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeFavoriteWords((words) => {
      if (active) setFavWords(words);
    });
    getFavoriteWords()
      .then((words) => {
        if (active) setFavWords(words);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  /**
   * 收藏或取消收藏某个单词的开关函数
   * @param {string} word 目标单词
   * @param {number} timestamp 音频播放时间戳或页面时间戳
   * @param {string} phonetic 单词音标
   * @param {string} definition 单词释义
   * @param {Array} examples 单词例句
   */
  const toggleFav = useCallback(
    (word, timestamp = null, phonetic = "", definition = "", examples = []) =>
      toggleUngroupedFavorite(word, {
        phonetic,
        definition,
        examples,
      }),
    []
  );

  /**
   * 批量将多个单词合并入生词本中
   * @param {Array<string>} words 单词数组
   */
  const mergeWords = useCallback((words) => mergeFavoriteWords(words), []);

  // 清空生词本
  const clearWords = useCallback(() => clearFavoriteWords(), []);
  const removeWord = useCallback((word) => removeFavoriteWord(word), []);

  // 将生词本对象转换为数组，并按照单词拼音字母排序缓存
  const favList = useMemo(
    () =>
      Object.entries(favWords || {}).sort(
        (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
      ),
    [favWords]
  );

  // 仅获取所有收藏单词的纯文本列表
  const wordList = useMemo(() => favList.map(([word]) => word), [favList]);

  const isFavorite = useCallback(
    (word) => favWords[normalizeWordKey(word)]?.ungrouped === true,
    [favWords]
  );

  return {
    favWords,
    favList,
    wordList,
    isLoading,
    isFavorite,
    toggleFav,
    mergeWords,
    clearWords,
    removeWord,
  };
}
