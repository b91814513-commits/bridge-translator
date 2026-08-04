import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import VideoLibraryOutlinedIcon from "@mui/icons-material/VideoLibraryOutlined";
import { useI18n } from "../../hooks/I18n";
import { useFavWords } from "../../hooks/FavWords";
import { useConfirm } from "../../hooks/Confirm";
import { useSetting } from "../../hooks/Setting";
import { isSingleChineseChar, isValidWord } from "../../libs/utils";
import { downloadBlobFile } from "../../libs/utils";
import { kissLog } from "../../libs/log";
import UploadButton from "./UploadButton";
import DictCont from "../Selection/DictCont";
import AiDictCont from "../Selection/AiDictCont";
import SugCont from "../Selection/SugCont";
import Zdic from "../Selection/Zdic";
import {
  DEFAULT_SETTING,
  DEFAULT_TRANBOX_SETTING,
  OPT_DICT_MAP,
  PROMPT_MODE_FOLLOW_API,
  findPromptBySlug,
  resolveApiPromptList,
} from "../../config";

const UNGROUPED_ID = "__ungrouped__";
const COMPACT_DICTIONARY_SX = {
  "& .MuiTypography-root": {
    fontSize: "0.8125rem",
    lineHeight: 1.4,
  },
  "& .MuiTypography-subtitle1": {
    fontSize: "0.875rem",
    lineHeight: 1.35,
  },
  "& .MuiStack-root": {
    rowGap: "4px",
  },
  "& .MuiDivider-root": {
    my: 0.5,
  },
  "& .MuiTab-root": {
    minHeight: 32,
    py: 0.25,
    fontSize: "0.75rem",
  },
  "& p, & li": {
    fontSize: "0.8125rem",
    lineHeight: 1.4,
  },
  "& ul, & ol": {
    my: 0.25,
  },
};

function resolveAiDictApiSetting({
  aiDictApiSlug,
  aiDictPromptSlug = PROMPT_MODE_FOLLOW_API,
  prompts = [],
  transApis = [],
}) {
  if (!aiDictApiSlug || aiDictApiSlug === "-") return null;
  const apiSetting = transApis.find((api) => api.apiSlug === aiDictApiSlug);
  if (!apiSetting) return null;
  if (aiDictPromptSlug === PROMPT_MODE_FOLLOW_API) {
    return apiSetting.dictPrompt ? apiSetting : null;
  }
  const prompt = findPromptBySlug(prompts, aiDictPromptSlug);
  if (!prompt) return null;
  return {
    ...apiSetting,
    dictPromptSlug: prompt.slug,
    dictPrompt: prompt.systemPrompt,
    dictUserPrompt: prompt.userPrompt,
  };
}

function formatTime(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "0:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function buildVideoUrl(occurrence) {
  if (!occurrence?.videoId) return "";
  const seconds = Math.floor((occurrence.timestamp || 0) / 1000);
  return `https://www.youtube.com/watch?v=${encodeURIComponent(occurrence.videoId)}&t=${seconds}s`;
}

function matchesSearch(entry, query) {
  if (!query) return true;
  const searchable = [
    entry.word,
    entry.definition,
    ...(entry.occurrences || []).flatMap((occurrence) => [
      occurrence.videoTitle,
      occurrence.originalText,
      occurrence.translation,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return searchable.includes(query);
}

function flattenExportRows(entries) {
  return entries.flatMap(([, entry]) => {
    const occurrences = entry.occurrences?.length ? entry.occurrences : [null];
    return occurrences.map((occurrence) => ({
      word: entry.word,
      phonetic: entry.phonetic || "",
      definition: entry.definition || "",
      examples: entry.examples || [],
      occurrence,
    }));
  });
}

function escapeCsv(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function buildExport(entries, format) {
  const rows = flattenExportRows(entries);
  if (format === "json") {
    return JSON.stringify(
      {
        exportVersion: 2,
        exportedAt: new Date().toISOString(),
        vocabulary: Object.fromEntries(entries),
      },
      null,
      2
    );
  }

  if (format === "csv") {
    const header = [
      "Word",
      "Phonetic",
      "Definition",
      "Video",
      "Original Context",
      "Translation",
      "Video Link",
    ].join(",");
    const lines = rows.map(({ word, phonetic, definition, occurrence }) =>
      [
        word,
        phonetic,
        definition,
        occurrence?.videoTitle,
        occurrence?.originalText,
        occurrence?.translation,
        buildVideoUrl(occurrence),
      ]
        .map(escapeCsv)
        .join(",")
    );
    return `\uFEFF${[header, ...lines].join("\n")}`;
  }

  if (format === "md") {
    const lines = ["# 生词本", ""];
    rows.forEach(({ word, phonetic, definition, occurrence }) => {
      lines.push(`## ${word}`);
      if (phonetic) lines.push(`- 音标：${phonetic}`);
      if (definition) lines.push(`- 释义：${definition}`);
      if (occurrence?.originalText)
        lines.push(`- 原句：${occurrence.originalText}`);
      if (occurrence?.translation)
        lines.push(`- 译文：${occurrence.translation}`);
      if (occurrence?.videoId) {
        lines.push(
          `- 来源：[${occurrence.videoTitle}](${buildVideoUrl(occurrence)})`
        );
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  const lines = [
    "生词本导出文件",
    `导出时间: ${new Date().toLocaleString()}`,
    "",
  ];
  rows.forEach(({ word, phonetic, definition, occurrence }, index) => {
    lines.push(`${index + 1}. ${word}`);
    if (phonetic) lines.push(`   音标: ${phonetic}`);
    if (definition) lines.push(`   释义: ${definition}`);
    if (occurrence?.originalText)
      lines.push(`   原句: ${occurrence.originalText}`);
    if (occurrence?.translation)
      lines.push(`   译文: ${occurrence.translation}`);
    if (occurrence?.videoId)
      lines.push(`   视频: ${buildVideoUrl(occurrence)}`);
    lines.push("");
  });
  return lines.join("\n");
}

function DictionaryDetails({ word, tranboxSetting, transApis, prompts }) {
  const i18n = useI18n();
  const [dictTab, setDictTab] = useState("default");
  const { enDict, enSug, aiDictApiSlug, aiDictPromptSlug, fromLang, toLang } =
    tranboxSetting || DEFAULT_TRANBOX_SETTING;
  const isWord = isValidWord(word);
  const isChineseChar = isSingleChineseChar(word);
  const defaultDictAvailable =
    (isWord && OPT_DICT_MAP.has(enDict)) || isChineseChar;
  const aiDictApiSetting = useMemo(
    () =>
      resolveAiDictApiSetting({
        aiDictApiSlug,
        aiDictPromptSlug,
        prompts,
        transApis,
      }),
    [aiDictApiSlug, aiDictPromptSlug, prompts, transApis]
  );
  const aiDictAvailable = Boolean(word?.trim() && aiDictApiSetting);

  return (
    <Stack spacing={1} sx={COMPACT_DICTIONARY_SX}>
      {aiDictAvailable ? (
        <Box>
          <Tabs
            value={defaultDictAvailable ? dictTab : "ai"}
            onChange={(_, value) => setDictTab(value)}
            sx={{ minHeight: 36, mb: 1 }}
          >
            {defaultDictAvailable ? (
              <Tab
                value="default"
                label={i18n("default_dict", "默认词典")}
                sx={{ minHeight: 36, py: 0.5 }}
              />
            ) : null}
            <Tab
              value="ai"
              label={i18n("ai_dict", "AI 词典")}
              sx={{ minHeight: 36, py: 0.5 }}
            />
          </Tabs>
          {defaultDictAvailable && dictTab === "default" ? (
            <>
              {isWord && OPT_DICT_MAP.has(enDict) ? (
                <DictCont text={word} enDict={enDict} />
              ) : null}
              {isChineseChar ? <Zdic text={word} /> : null}
            </>
          ) : (
            <AiDictCont
              text={word}
              fromLang={fromLang}
              speechLang={fromLang}
              toLang={toLang}
              apiSetting={aiDictApiSetting}
            />
          )}
        </Box>
      ) : (
        <>
          {isWord && OPT_DICT_MAP.has(enDict) ? (
            <DictCont text={word} enDict={enDict} />
          ) : null}
          {isChineseChar ? <Zdic text={word} /> : null}
        </>
      )}
      <SugCont text={word} enSug={enSug} />
    </Stack>
  );
}

function SourceContext({ occurrence }) {
  const i18n = useI18n();
  if (!occurrence) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontSize: "0.8125rem", lineHeight: 1.4 }}
      >
        {i18n("vocabulary_ungrouped", "未分组")}
      </Typography>
    );
  }
  return (
    <Box
      sx={{ borderLeft: 2, borderColor: "primary.main", pl: 1.25, py: 0.125 }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ mb: 0.25 }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ fontSize: "0.75rem", lineHeight: 1.35 }}
        >
          {occurrence.videoTitle || "YouTube Video"}
        </Typography>
        <Button
          component="a"
          href={buildVideoUrl(occurrence)}
          target="_blank"
          rel="noopener noreferrer"
          size="small"
          endIcon={<OpenInNewIcon fontSize="inherit" />}
          sx={{
            minWidth: 0,
            minHeight: 24,
            px: 0.75,
            py: 0,
            fontSize: "0.75rem",
            lineHeight: 1.35,
            textTransform: "none",
          }}
        >
          {formatTime(occurrence.timestamp)}
        </Button>
      </Stack>
      {occurrence.originalText ? (
        <Typography
          variant="body2"
          sx={{ fontSize: "0.8125rem", lineHeight: 1.4 }}
        >
          {occurrence.originalText}
        </Typography>
      ) : null}
      {occurrence.translation ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.125, fontSize: "0.8125rem", lineHeight: 1.4 }}
        >
          {occurrence.translation}
        </Typography>
      ) : null}
    </Box>
  );
}

function WordAccordion({
  entry,
  occurrence = null,
  onDelete,
  tranboxSetting,
  transApis,
  prompts,
}) {
  const [expanded, setExpanded] = useState(false);
  const contexts = occurrence
    ? [occurrence]
    : entry.occurrences?.length
      ? entry.occurrences
      : [null];

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, value) => setExpanded(value)}
      disableGutters
      elevation={0}
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ minWidth: 0, width: "100%", pr: 1 }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {entry.word}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {entry.definition || occurrence?.originalText || ""}
            </Typography>
          </Box>
          {entry.occurrences?.length ? (
            <Chip
              size="small"
              label={entry.occurrences.length}
              icon={<VideoLibraryOutlinedIcon />}
              sx={{ flexShrink: 0 }}
            />
          ) : null}
          <IconButton
            size="small"
            title="删除词条"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(entry.word);
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1, pt: 0.25, pb: 1.25 }}>
        <Stack spacing={1}>
          {contexts.map((context, index) => (
            <SourceContext
              key={context ? `${context.videoId}:${context.timestamp}` : index}
              occurrence={context}
            />
          ))}
          {expanded ? (
            <>
              <Divider />
              <DictionaryDetails
                word={entry.word}
                tranboxSetting={tranboxSetting}
                transApis={transApis}
                prompts={prompts}
              />
            </>
          ) : null}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function FavWords() {
  const i18n = useI18n();
  const { favList, mergeWords, clearWords, removeWord } = useFavWords();
  const { setting } = useSetting();
  const { transApis, prompts, subtitleSetting, tranboxSetting } =
    setting || DEFAULT_SETTING;
  const resolvedTransApis = useMemo(
    () => resolveApiPromptList(transApis, prompts, subtitleSetting),
    [prompts, subtitleSetting, transApis]
  );
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const [exportAnchor, setExportAnchor] = useState(null);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return favList.filter(([, entry]) => matchesSearch(entry, normalizedQuery));
  }, [favList, query]);

  const videoGroups = useMemo(() => {
    const groups = new Map();
    filteredEntries.forEach(([key, entry]) => {
      (entry.occurrences || []).forEach((occurrence) => {
        const group = groups.get(occurrence.videoId) || {
          id: occurrence.videoId,
          title: occurrence.videoTitle || "YouTube Video",
          updatedAt: 0,
          entries: [],
        };
        group.updatedAt = Math.max(group.updatedAt, occurrence.addedAt || 0);
        group.entries.push([key, entry, occurrence]);
        groups.set(occurrence.videoId, group);
      });
      if (entry.ungrouped) {
        const group = groups.get(UNGROUPED_ID) || {
          id: UNGROUPED_ID,
          title: i18n("vocabulary_ungrouped", "未分组"),
          updatedAt: 0,
          entries: [],
        };
        group.updatedAt = Math.max(group.updatedAt, entry.updatedAt || 0);
        group.entries.push([key, entry, null]);
        groups.set(UNGROUPED_ID, group);
      }
    });
    return Array.from(groups.values()).sort(
      (left, right) => right.updatedAt - left.updatedAt
    );
  }, [filteredEntries, i18n]);

  const handleImport = (data) => {
    try {
      const words = data
        .split(/\r?\n/)
        .map((line) => line.split(",")[0].replace(/^"|"$/g, "").trim())
        .filter(
          (word, index) => !(index === 0 && word.toLowerCase() === "word")
        )
        .filter(isValidWord);
      return mergeWords(words);
    } catch (error) {
      kissLog("import favorite words", error);
    }
  };

  const handleDelete = async (word) => {
    const accepted = await confirm({
      confirmText: i18n("confirm_title"),
      cancelText: i18n("cancel"),
    });
    if (accepted) await removeWord(word);
  };

  const handleClear = async () => {
    const accepted = await confirm({
      confirmText: i18n("confirm_title"),
      cancelText: i18n("cancel"),
    });
    if (accepted) await clearWords();
  };

  const handleExport = (format) => {
    const content = buildExport(filteredEntries, format);
    const mime = format === "json" ? "application/json" : "text/plain";
    downloadBlobFile(
      new Blob([content], { type: `${mime};charset=utf-8` }),
      `bridge-vocabulary-${new Date().toISOString().slice(0, 10)}.${format}`
    );
    setExportAnchor(null);
  };

  return (
    <Box sx={{ maxWidth: 1040, mx: "auto" }}>
      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={1.5}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {i18n("vocabulary_book", "生词本")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {favList.length} {i18n("vocabulary_count_unit", "个词")}
            </Typography>
          </Box>
          <TextField
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={i18n("search_vocabulary", "搜索单词、释义或视频")}
            inputProps={{ "aria-label": i18n("search", "搜索") }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ width: { md: 320 } }}
          />
        </Stack>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={1}
        >
          <Tabs
            value={view}
            onChange={(_, value) => setView(value)}
            sx={{ minHeight: 38, flex: 1 }}
          >
            <Tab
              value="all"
              label={i18n("all_vocabulary", "全部词汇")}
              sx={{ minHeight: 38, py: 0 }}
            />
            <Tab
              value="videos"
              label={i18n("group_by_video", "按视频")}
              sx={{ minHeight: 38, py: 0 }}
            />
          </Tabs>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <UploadButton
              text={i18n("import")}
              handleImport={handleImport}
              fileType=""
              fileExts={[".txt", ".csv"]}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<FileDownloadIcon />}
              onClick={(event) => setExportAnchor(event.currentTarget)}
            >
              {i18n("export")}
            </Button>
            <Menu
              anchorEl={exportAnchor}
              open={Boolean(exportAnchor)}
              onClose={() => setExportAnchor(null)}
            >
              {["txt", "csv", "md", "json"].map((format) => (
                <MenuItem key={format} onClick={() => handleExport(format)}>
                  {format.toUpperCase()}
                </MenuItem>
              ))}
            </Menu>
            <IconButton
              size="small"
              color="error"
              title={i18n("clear_all")}
              onClick={handleClear}
              disabled={favList.length === 0}
            >
              <ClearAllIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        <Divider />

        {filteredEntries.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Typography color="text.secondary">
              {query
                ? i18n("no_search_results", "没有匹配的词汇")
                : i18n("vocabulary_empty", "暂无收藏词汇")}
            </Typography>
          </Box>
        ) : view === "all" ? (
          <Box>
            {filteredEntries.map(([key, entry]) => (
              <WordAccordion
                key={key}
                entry={entry}
                onDelete={handleDelete}
                tranboxSetting={tranboxSetting}
                transApis={resolvedTransApis}
                prompts={prompts}
              />
            ))}
          </Box>
        ) : (
          <Stack spacing={2}>
            {videoGroups.map((group) => (
              <Box key={group.id}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ mb: 0.5 }}
                >
                  <VideoLibraryOutlinedIcon color="action" fontSize="small" />
                  <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
                    {group.title}
                  </Typography>
                  <Chip size="small" label={group.entries.length} />
                </Stack>
                {group.entries.map(([key, entry, occurrence]) => (
                  <WordAccordion
                    key={`${group.id}:${key}`}
                    entry={entry}
                    occurrence={occurrence}
                    onDelete={handleDelete}
                    tranboxSetting={tranboxSetting}
                    transApis={resolvedTransApis}
                    prompts={prompts}
                  />
                ))}
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
