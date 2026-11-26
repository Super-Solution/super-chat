"use client";

// Every word the kit writes on screen, as data.
//
// One table, English by default, with a zh-TW preset beside it. A host overrides
// any subset (`<LabelsProvider labels={{ send: "Ask" }}>`) or swaps the whole
// language (`<LabelsProvider labels={zhTW}>`); providers nest, so a panel can
// reword one corner. Without a provider the English defaults apply, which keeps
// every existing integration exactly as it was.
//
// Strings that carry a value (a file name, a count) are functions rather than
// templates, because plurals and word order differ by language and a template
// cannot express them. Nothing in here is HTML: a label is text, set as text.

import { createContext, useContext, useMemo, type ReactNode } from "react";

export type ChatPanelLabels = {
  /** The line left in the chat for a card shown in the panel. */
  opened: string;
  /** Its button when the card is not the one in the panel. */
  open: string;
  /** Its state when the card is the one in the panel. */
  showing: string;
  /** The panel's close button. */
  close: string;
  /** The panel's heading for a card without a title. */
  untitled: string;
};

export type Labels = {
  // The conversation
  /** The accessible name of the message list (`role="log"`). */
  thread: string;
  /** Announced when a turn starts. */
  responding: string;
  /** Announced when a turn is finished. */
  replied: string;
  /** The jump-to-end button. */
  latest: string;
  today: string;
  yesterday: string;
  noResponse: string;
  somethingWrong: string;
  retry: string;
  // What you can do with a message
  copy: string;
  copied: string;
  copyFailed: string;
  /** The accessible name of the pair of thumbs. */
  feedback: string;
  feedbackGood: string;
  feedbackBad: string;
  previousBranch: string;
  nextBranch: string;
  editMessage: string;
  editHint: string;
  sendEdited: string;
  cancel: string;
  // Work shown under an answer
  toolCalls: (count: number, ms?: string) => string;
  toolsRunning: (done: number, total: number, current?: string) => string;
  toolsFailed: (count: number) => string;
  thinking: string;
  thought: string;
  /** `seconds` is the count alone ("3"); the label owns the unit. */
  thoughtFor: (seconds: string) => string;
  toggleThought: string;
  /** Provider-side work, by the kind the provider reported. */
  providerTools: Record<string, string>;
  providerToolFallback: string;
  statusBackground: (status: string) => string;
  statusWaiting: string;
  statusPreparing: (tool: string) => string;
  statusRunning: (tool: string) => string;
  statusStep: (step: number) => string;
  // Attachments
  attachedImage: string;
  attachedAudio: string;
  attachment: string;
  attachFile: string;
  removeAttachment: (name: string) => string;
  fileTooLarge: (name: string, max: string) => string;
  fileNotAccepted: (name: string) => string;
  quotedFromDocument: string;
  removeQuote: (title: string) => string;
  // Composer
  placeholder: string;
  send: string;
  stop: string;
  stopping: string;
  model: string;
  // Empty state and suggestions
  emptyTitle: string;
  emptyDescription: string;
  suggestions: string;
  // Rendered Markdown
  table: string;
  copyTable: string;
  copyTsv: string;
  copyMarkdown: string;
  copyCode: string;
  wrapCode: string;
  expandCode: string;
  collapseCode: string;
  // Cards
  gauge: string;
  /** Names the corner cell of a comparison table, which is empty to the eye. */
  criterion: string;
  progress: string;
  todos: string;
  documentBody: string;
  documentRevision: string;
  dismissQuote: string;
  emailBody: string;
  emailOpens: string;
  sources: string;
  source: (n: number) => string;
  showAll: (count: number) => string;
  showLess: string;
  download: (name: string) => string;
  /** The visible word on a download button whose full name is in `download`. */
  downloadShort: string;
  yes: string;
  no: string;
  /** A card's own open and close buttons. */
  expand: string;
  collapse: string;
  askAboutThis: string;
  toggle: (title: string) => string;
  blocked: string;
  complete: string;
  /** The collapsed head of a plan, read as one sentence. */
  planStatus: (title: string, settled: number, total: number, summary: string) => string;
  showAllLines: (count: number) => string;
  showFewerLines: string;
  generatedImage: string;
  generatedAudio: string;
  generatedVideo: string;
  // Email card
  emailTo: string;
  emailCc: string;
  emailSubject: string;
  emailTooLong: (length: number) => string;
  emailDownload: string;
  emailOpenMail: string;
  emailSending: string;
  emailSent: string;
  // Questions a card asks, and how it says they were answered
  submit: string;
  confirm: string;
  confirmSelection: (count: number) => string;
  skip: string;
  answered: string;
  skipped: string;
  confirmed: string;
  declined: string;
  applyChange: string;
  applyAll: string;
  applySome: (accepted: number, total: number) => string;
  rejectAll: string;
  // Interfaces an agent builds
  surfaceFallbackName: string;
  surfaceRemoved: (name: string) => string;
  surfaceBeside: (name: string) => string;
  surfaceUpdated: (name: string) => string;
  surfacePartFailed: string;
  surfaceImageBlocked: string;
  surfaceNoRenderer: (name: string) => string;
  // The agent input
  add: string;
  attachImage: string;
  skills: string;
  improve: string;
  revert: string;
  improveHint: string;
  revertHint: string;
  // The side panel
  panel: ChatPanelLabels;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const enLabels: Labels = {
  thread: "Conversation",
  responding: "Assistant is responding…",
  replied: "Assistant replied.",
  latest: "Latest",
  today: "Today",
  yesterday: "Yesterday",
  noResponse: "(no response)",
  somethingWrong: "Something went wrong.",
  retry: "Retry",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  feedback: "Rate this response",
  feedbackGood: "Good response",
  feedbackBad: "Bad response",
  previousBranch: "Previous branch",
  nextBranch: "Next branch",
  editMessage: "Edit message",
  editHint: "Edit. The original stays as a branch you can switch back to.",
  sendEdited: "Send edited",
  cancel: "Cancel",
  toolCalls: (count, ms) => `${count} tool ${plural(count, "call", "calls")}${ms ? ` · ${ms}` : ""}`,
  toolsRunning: (done, total, current) => `Running tools ${done}/${total}${current ? ` · ${current}` : ""}…`,
  toolsFailed: (count) => `${count} failed`,
  thinking: "Thinking…",
  thought: "Thought",
  thoughtFor: (seconds) => `Thought for ${seconds}s`,
  toggleThought: "Toggle thought",
  providerTools: {
    web_search_call: "Searched the web",
    web_fetch_tool_result: "Fetched a page",
    code_interpreter_call: "Ran code",
    server_tool_use: "Used a hosted tool",
    web_search_tool_result: "Searched the web",
    bash_code_execution_tool_result: "Ran code",
  },
  providerToolFallback: "Used a hosted tool",
  statusBackground: (status) => `Working in the background — ${status}`,
  statusWaiting: "Waiting for you",
  statusPreparing: (tool) => `Preparing ${tool}…`,
  statusRunning: (tool) => `Running ${tool}…`,
  statusStep: (step) => `Working — step ${step}`,
  attachedImage: "attached image",
  attachedAudio: "Attached audio",
  attachment: "attachment",
  attachFile: "Attach a file",
  removeAttachment: (name) => `Remove ${name}`,
  fileTooLarge: (name, max) => `${name} is larger than ${max} and was not attached.`,
  fileNotAccepted: (name) => `${name} is not a type that can be attached.`,
  quotedFromDocument: "Quoted from a document",
  removeQuote: (title) => `Remove quote from ${title}`,
  placeholder: "Ask anything…",
  send: "Send",
  stop: "Stop",
  stopping: "Stopping…",
  model: "Model",
  emptyTitle: "How can I help?",
  emptyDescription: "Ask a question, or start from one of these.",
  suggestions: "Suggestions",
  table: "Table",
  copyTable: "Copy table",
  copyTsv: "Copy as TSV",
  copyMarkdown: "Copy as Markdown",
  copyCode: "Copy code",
  wrapCode: "Wrap lines",
  expandCode: "Show all",
  collapseCode: "Show less",
  gauge: "Gauge",
  criterion: "Criteria",
  progress: "Progress",
  todos: "To-dos",
  documentBody: "Document",
  documentRevision: "Document revision",
  dismissQuote: "Dismiss quote",
  emailBody: "Email body",
  emailOpens: "Opens your mail client",
  sources: "Sources",
  source: (n) => `Source ${n}`,
  showAll: (count) => `Show all ${count}`,
  showLess: "Show less",
  download: (name) => `Download ${name}`,
  downloadShort: "Download",
  yes: "yes",
  no: "no",
  expand: "Open",
  collapse: "Close",
  askAboutThis: "Ask about this",
  toggle: (title) => `Toggle ${title}`,
  blocked: "Blocked",
  complete: "Complete",
  planStatus: (title, settled, total, summary) => `${title} — ${settled} of ${total} — ${summary}`,
  showAllLines: (count) => `Show all (${count} lines)`,
  showFewerLines: "Show fewer lines",
  generatedImage: "Generated image",
  generatedAudio: "Generated audio",
  generatedVideo: "Generated video",
  emailTo: "To",
  emailCc: "Cc",
  emailSubject: "Subject",
  emailTooLong: (length) =>
    `This is too long for a mailto link (${length} characters) — some mail clients will cut it short. Download the .eml instead.`,
  emailDownload: "Download .eml",
  emailOpenMail: "Open in mail client",
  emailSending: "Sending…",
  emailSent: "Sent",
  submit: "Submit",
  confirm: "Confirm",
  confirmSelection: (count) => `Confirm selection (${count})`,
  skip: "Skip",
  answered: "Answered.",
  skipped: "Skipped.",
  confirmed: "Confirmed.",
  declined: "Declined.",
  applyChange: "Apply change",
  applyAll: "Apply all changes",
  applySome: (accepted, total) => `Apply ${accepted} of ${total}`,
  rejectAll: "Reject all",
  surfaceFallbackName: "the interface",
  surfaceRemoved: (name) => `Removed ${name}`,
  surfaceBeside: (name) => `${name} is open beside the conversation`,
  surfaceUpdated: (name) => `Updated ${name}`,
  surfacePartFailed: "This part stopped working.",
  surfaceImageBlocked: "The image address isn’t allowed.",
  surfaceNoRenderer: (name) => `No renderer is registered for ${name}.`,
  add: "Add",
  attachImage: "Attach an image",
  skills: "Skills",
  improve: "Improve",
  revert: "Revert",
  improveHint: "Improve this prompt",
  revertHint: "Revert to your original prompt",
  panel: {
    opened: "Opened beside the chat",
    open: "Open",
    showing: "Showing",
    close: "Close panel",
    untitled: "Panel",
  },
};

/** Traditional Chinese (Taiwan). Full-width punctuation, no spaces around numbers and CJK. */
export const zhTW: Labels = {
  thread: "對話",
  responding: "助理正在回覆…",
  replied: "助理已回覆。",
  latest: "回到最新",
  today: "今天",
  yesterday: "昨天",
  noResponse: "（沒有回覆）",
  somethingWrong: "發生了一點問題。",
  retry: "重試",
  copy: "複製",
  copied: "已複製",
  copyFailed: "複製失敗",
  feedback: "評價這則回覆",
  feedbackGood: "回答得好",
  feedbackBad: "回答不好",
  previousBranch: "上一個分支",
  nextBranch: "下一個分支",
  editMessage: "編輯訊息",
  editHint: "編輯。原本的訊息會留成一個分支，可以隨時切換回去。",
  sendEdited: "送出修改",
  cancel: "取消",
  toolCalls: (count, ms) => `${count} 次工具呼叫${ms ? ` · ${ms}` : ""}`,
  toolsRunning: (done, total, current) => `工具執行中 ${done}/${total}${current ? ` · ${current}` : ""}…`,
  toolsFailed: (count) => `${count} 次失敗`,
  thinking: "思考中…",
  thought: "已思考",
  thoughtFor: (seconds) => `已思考 ${seconds} 秒`,
  toggleThought: "展開或收合思考過程",
  providerTools: {
    web_search_call: "已搜尋網路",
    web_fetch_tool_result: "已讀取網頁",
    code_interpreter_call: "已執行程式碼",
    server_tool_use: "已使用託管工具",
    web_search_tool_result: "已搜尋網路",
    bash_code_execution_tool_result: "已執行程式碼",
  },
  providerToolFallback: "已使用託管工具",
  statusBackground: (status) => `正在背景處理：${status}`,
  statusWaiting: "等你回應",
  statusPreparing: (tool) => `正在準備 ${tool}…`,
  statusRunning: (tool) => `正在執行 ${tool}…`,
  statusStep: (step) => `處理中，第 ${step} 步`,
  attachedImage: "附加的圖片",
  attachedAudio: "附加的音訊",
  attachment: "附件",
  attachFile: "附加檔案",
  removeAttachment: (name) => `移除 ${name}`,
  fileTooLarge: (name, max) => `${name} 超過 ${max}，沒有附加。`,
  fileNotAccepted: (name) => `${name} 的類型不能附加。`,
  quotedFromDocument: "引用自文件",
  removeQuote: (title) => `移除來自「${title}」的引用`,
  placeholder: "有什麼想問的？",
  send: "送出",
  stop: "停止",
  stopping: "停止中…",
  model: "模型",
  emptyTitle: "需要什麼協助？",
  emptyDescription: "直接提問，或從下面挑一個開始。",
  suggestions: "建議的問題",
  table: "表格",
  copyTable: "複製表格",
  copyTsv: "複製為 TSV",
  copyMarkdown: "複製為 Markdown",
  copyCode: "複製程式碼",
  wrapCode: "自動換行",
  expandCode: "顯示全部",
  collapseCode: "收合",
  gauge: "量表",
  criterion: "比較項目",
  progress: "進度",
  todos: "待辦事項",
  documentBody: "文件",
  documentRevision: "文件版本",
  dismissQuote: "取消引用",
  emailBody: "郵件內容",
  emailOpens: "會開啟你的郵件程式",
  sources: "來源",
  source: (n) => `來源 ${n}`,
  showAll: (count) => `顯示全部 ${count} 筆`,
  showLess: "收合",
  download: (name) => `下載 ${name}`,
  downloadShort: "下載",
  yes: "是",
  no: "否",
  expand: "展開",
  collapse: "收合",
  askAboutThis: "針對這段提問",
  toggle: (title) => `展開或收合 ${title}`,
  blocked: "受阻",
  complete: "完成",
  planStatus: (title, settled, total, summary) => `${title}：${total} 項中已完成 ${settled} 項，${summary}`,
  showAllLines: (count) => `顯示全部 ${count} 行`,
  showFewerLines: "顯示較少行數",
  generatedImage: "產生的圖片",
  generatedAudio: "產生的音訊",
  generatedVideo: "產生的影片",
  emailTo: "收件人",
  emailCc: "副本",
  emailSubject: "主旨",
  emailTooLong: (length) => `內容太長（${length} 字元），超出 mailto 連結的範圍，部分郵件程式會截斷。請改下載 .eml。`,
  emailDownload: "下載 .eml",
  emailOpenMail: "用郵件程式開啟",
  emailSending: "傳送中…",
  emailSent: "已傳送",
  submit: "送出",
  confirm: "確認",
  confirmSelection: (count) => `確認選擇（${count}）`,
  skip: "略過",
  answered: "已回答。",
  skipped: "已略過。",
  confirmed: "已確認。",
  declined: "已拒絕。",
  applyChange: "套用這項修改",
  applyAll: "套用所有修改",
  applySome: (accepted, total) => `套用 ${total} 項中的 ${accepted} 項`,
  rejectAll: "全部拒絕",
  surfaceFallbackName: "這個介面",
  surfaceRemoved: (name) => `已移除${name}`,
  surfaceBeside: (name) => `${name}已在對話旁邊開啟`,
  surfaceUpdated: (name) => `已更新${name}`,
  surfacePartFailed: "這個部分發生了問題。",
  surfaceImageBlocked: "不允許這個圖片位址。",
  surfaceNoRenderer: (name) => `沒有註冊「${name}」的呈現元件。`,
  add: "新增",
  attachImage: "附加圖片",
  skills: "技能",
  improve: "優化",
  revert: "還原",
  improveHint: "優化這段提示",
  revertHint: "還原成你原本的提示",
  panel: {
    opened: "已在聊天旁邊開啟",
    open: "開啟",
    showing: "顯示中",
    close: "關閉面板",
    untitled: "面板",
  },
};

/** What a host may pass: any subset, with `panel` itself partial. */
export type LabelsOverride = Partial<Omit<Labels, "panel" | "providerTools">> & {
  panel?: Partial<ChatPanelLabels>;
  providerTools?: Record<string, string>;
};

const Context = /* @__PURE__ */ createContext<Labels>(enLabels);

/** The words in force: the nearest provider's, or English. */
export function useLabels(): Labels {
  return useContext(Context);
}

/**
 * Sets the words for everything below it. `labels` may be a whole language
 * (`zhTW`) or a few words; what it leaves out comes from the provider above, or
 * English.
 */
export function LabelsProvider({ labels, children }: { labels: LabelsOverride; children: ReactNode }) {
  const parent = useContext(Context);
  const merged = useMemo<Labels>(
    () => ({
      ...parent,
      ...labels,
      panel: { ...parent.panel, ...labels.panel },
      providerTools: { ...parent.providerTools, ...labels.providerTools },
    }),
    [parent, labels],
  );
  return <Context.Provider value={merged}>{children}</Context.Provider>;
}

/** Fill the template-free words of a file size: `1.5 MB`. */
export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
