import IconButton from "@mui/material/IconButton";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { useState } from "react";
import { useFavWords } from "../../hooks/FavWords";
import { kissLog } from "../../libs/log";

/**
 * 收藏生词按钮组件 (红心图标)
 *
 * @param {Object} props
 * @param {string} props.word - 需要被收藏或取消收藏的单词
 * @param {string} props.title - 鼠标悬停提示文本
 */
export default function FavBtn({ word, title }) {
  // 使用自定义的 useFavWords 获取收藏的生词列表及切换收藏状态的方法
  const { isFavorite, toggleFav } = useFavWords();
  const [loading, setLoading] = useState(false);

  // 点击触发收藏/取消收藏
  const handleClick = async () => {
    try {
      setLoading(true);
      await toggleFav(word);
    } catch (err) {
      kissLog("set fav", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <IconButton
      disabled={loading}
      size="small"
      onClick={handleClick}
      title={title}
    >
      {/* 如果单词已存在于生词本中，渲染实心红心，否则为空心红心 */}
      {isFavorite(word) ? (
        <FavoriteIcon fontSize="inherit" />
      ) : (
        <FavoriteBorderIcon fontSize="inherit" />
      )}
    </IconButton>
  );
}
