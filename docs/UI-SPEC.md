# UI 規範 — 設計點盤點（Phase 1）

2026-08-04 起草。本文件是 agentic chat flow 會出現的 UI 表示的**全量清單**，
作為後續逐節展開規範（tokens、行為、無障礙、動效）的骨架。

參考對象：Open WebUI、Claude（claude.ai / Cowork / Claude Code）、Gemini、
ChatGPT、Perplexity 等產品的流程。

現況標記：✅ 已有｜🟡 部分（樣式或狀態存在但不完整）｜❌ 未有。
現況對應的程式位置：樣式集中在 `packages/ui/src/styles.css`，
行為在 `packages/ui/src/Thread.tsx` 與 `packages/ui/src/cards/*`。

章節對應最初提出的四大點：**B = 卡片與裝飾物件、C = 聊天框、D = 思考狀態、
E = 執行狀態**。A 是它們共同的載體（訊息流），0 是所有章節共用的基底。

---

## 0. 設計基底（tokens）

所有章節共用的底層，先定它才有「規範」可言。

| # | 設計點 | 要規範什麼 | 現況 |
|---|--------|-----------|------|
| 0.1 | 色彩 tokens | 語意色（bg/surface/border/text/accent/positive…）、light/dark 對應 | ✅ `--sc-*` 三段定義齊全 |
| 0.2 | 間距 scale | 2–48 的固定 scale，全檔遷移完成 | ✅ Batch 2 |
| 0.3 | 字級 scale | 角色化 token（body/ui/meta/micro/stat/hero）+ 三段行高 | ✅ Batch 2＋4.1 |
| 0.4 | 圓角 / 邊框 | radius 兩級已有；邊框寬度、何時用 dashed | ✅ `--sc-radius` / `--sc-radius-sm` |
| 0.5 | 動效 tokens | dur-1/2/3 + 兩條 easing；每個動效都有 reduced-motion 退化（CSSOM 驗過 4 條） | ✅ Batch 2 |
| 0.6 | 圖示系統 | 維持字元 glyph，訂出 canonical 表（見 2.0.6），不引 icon 庫 | ✅ 規範定案 |
| 0.7 | 層級 / elevation | z scale 五級 + overlay 陰影（含 dark 變體）；in-flow 一律 border-only | ✅ Batch 2 |

## A. 訊息流基礎（thread）

| # | 設計點 | 要規範什麼 | 參考 | 現況 |
|---|--------|-----------|------|------|
| A.1 | 使用者氣泡 | 寬度上限 + 氣泡內附件（縮圖／檔名 chip）；過長內容摺疊未做 | 各家皆同構 | ✅ Batch B |
| A.2 | 助理訊息本文 | thread 內助理文字經共用 `renderMarkdown`（escape-first、含 fenced code）渲染；表格、數學式仍無 | Open WebUI 的完整 markdown + code toolbar | ✅ 基本（Batch 1） |
| A.3 | streaming 游標 | `.sc-msg__text--streaming::after` 方塊游標，1s step-end 閃爍；reduced-motion 靜止 | ChatGPT / Gemini | ✅ Batch B |
| A.4 | 訊息操作列 | `.sc-msgmeta` 常駐 Copy／Retry（**不做 hover 顯示**——觸控裝置上不存在）；編輯與回饋未做 | Open WebUI 每則訊息下方 action row | 🟡 Batch B |
| A.5 | 版本與分支 | regenerate 後的 ‹ 2/3 › 分頁、編輯後分支 | ChatGPT | ❌ |
| A.6 | 錯誤訊息與 retry | 行內 error 卡 + Retry（走 `regenerate()`）；reducer 終態修正——失敗維持 `error`、使用者取消映射為 `done` | 各家 | ✅（Batch 1） |
| A.7 | 空狀態 | 首屏問候、建議 prompts（starter chips） | Gemini / ChatGPT 首屏 | 🟡 `sc-empty` 有、starter 無 |
| A.8 | 捲動行為 | pinning + `.sc-jump` 置中膠囊（僅未貼底時出現）；新訊息計數未做 | 各家 | ✅ Batch B |
| A.9 | 分隔與章節 | `.sc-daydivider`：Today／Yesterday／寫出日期，僅在跨日時插入；章節標記未做 | Claude Code chapters | 🟡 Batch B |
| A.10 | 訊息 meta | `TurnMeta`（model／耗時／tokens）由 `commitRun` 寫進 message metadata，`.sc-msgmeta` 顯示 | Open WebUI（info icon） | ✅ Batch A+B |

## B. 卡片與裝飾性物件

| # | 設計點 | 要規範什麼 | 參考 | 現況 |
|---|--------|-----------|------|------|
| B.1 | 卡片基底 | padding / radius / border / title / caption / footnote 結構 | — | ✅ `.sc-card` + 子元素 |
| B.2 | tone 變體 | interactive / danger / muted / error 的邊框與底色規則 | — | ✅ 四變體 |
| B.3 | 裝飾物件 | 三條規則成文並稽核全部卡片（pill 不當按鈕、callout 不巢狀、divider 每卡至多一條）；`.sc-divider` 已備 | — | ✅ Batch C |
| B.4 | 20 種內建卡 | 各 kind 的欄位密度、對齊、數字排版（tabular-nums） | — | ✅ 全數實作，**但從未在瀏覽器實看過**（HANDOFF 警告） |
| B.5 | 卡片 loading 骨架 | `CardSkeleton`：延遲 200ms 才出現、aria-busy + sr-only 標籤 | Cowork、Gemini 的 tool 卡 | ✅ Batch 4 |
| B.6 | 卡片 error / 未知 fallback | 未註冊 kind、render 拋錯、payload 過期三種退化態 | — | ✅ `CardBoundary` + unrendered + expired 都有 |
| B.7 | 卡片操作 | 共用 `CardActions`：table/markdown/code 皆有 Copy+Download，失敗顯示 `Copy failed`；全螢幕與 refresh 未做 | Open WebUI code toolbar、ChatGPT 圖表展開 | 🟡 Batch C |
| B.8 | 長內容截斷 | 表格 >30 列收成 `Show all (N)`，且作用在**排序後**的順序上 | — | ✅ Batch C |
| B.9 | 響應式 | 375px 實測：無頁面橫向溢出、22 張卡皆不撐破、氣泡 254/375 | — | ✅ 已驗證 |

## C. 聊天框（composer）

| # | 設計點 | 要規範什麼 | 參考 | 現況 |
|---|--------|-----------|------|------|
| C.1 | 輸入區 | auto-grow 40→180 封頂、送出後縮回、`resize: none` | 各家 | ✅（Batch 1） |
| C.2 | IME 組字 | Enter 檢查 `isComposing` + keyCode 229，組字確認不再誤送出 | 中文輸入必修 | ✅（Batch 1） |
| C.3 | 送出 / 停止 | 按鈕狀態機 + `stopping` 中間態（Stopping… 且 disabled）；running 中排隊未做 | ChatGPT 可排隊 | 🟡 Batch A+B |
| C.4 | 附件 | 拖放＋貼上 → base64 `MediaSource` part；chips 可移除、依身分去重；**無上傳進度**（kit 無儲存層，host 可換成 providerFile） | 各家 | 🟡 Batch D |
| C.5 | 模型 / 模式選擇 | `models`/`model`/`onModelChange` 槽位，位於 composer 內下列左側；清單由 host 給，kit 不臆造 | Open WebUI composer 上緣 | ✅ Batch D |
| C.6 | 工具開關 | `toolToggles` 槽位，`aria-pressed` + 邊框/字重雙訊號（不只靠顏色） | Gemini / ChatGPT | ✅ Batch D |
| C.7 | slash 指令 | `/` 開 skills 選單；僅在詞首觸發（路徑不誤觸發）、↑↓/Enter/Tab/Esc 全支援 | Claude Code / Cowork | ✅ Batch D |
| C.8 | @ 提及 | `@` 開 tools 選單，與 `/` 共用一套元件；email 不誤觸發 | Cursor / Cowork | ✅ Batch D |
| C.9 | 長度與限制 | `estimateTokens` 即時計數，>400 才顯示；`maxInputTokens` 超限則變紅並擋住送出 | — | ✅ Batch D |
| C.10 | 鍵盤規範 | Enter 送出 / Shift+Enter 換行 / Esc 停止 / ↑ 空白時召回上一則；全部有 IME 組字防護 | 各家 | ✅ Batch 4+B |

### C.3-gap — 停止沒有回饋（✅ 已修 Batch A+B）

`stop()` 只 abort signal。工具若不理會 `ctx.signal`（自行 `await` 到底），
run 會一路跑完，而 UI **完全沒有任何表示**：按鈕仍是 Stop、沒有
「停止中…」、也沒有「已送出停止要求」。使用者只會覺得按鈕壞了。

實測佐證：對一個忽略 signal 的工具按 Esc，`preventDefault` 有生效、
`stop()` 有被呼叫，但畫面毫無變化；同一情境下點 Stop 按鈕結果相同——
所以這不是 Esc 的問題，是停止語意本身缺一個中間態。在正常路徑
（等待模型／串流中）Esc 與 Stop 都能正常結束 run，已實測。

**已實作**：`ThreadState.stopping` 由 `AgentClient.stop()` 立刻設起、
`commitRun` 清除，`useThread()` 暴露；按鈕按下即變 `Stopping…` 並 disabled。
逾時提示（「這個工具不支援中斷」）未做——需要一個逾時門檻，而合理的門檻
取決於 host 的工具特性，kit 不該替它猜。

**由此收斂出一條通則**：任何「已收到請求但尚未完成」的動作都需要中間態。
同一個模式在這輪又出現一次——copy 失敗時原本靜默 catch，使用者看到的
是按鈕毫無反應，與按鈕壞掉無法區分。已改為顯示 `Copy failed`。
判準：**沒有可見結果的點擊，等於壞掉的按鈕**。

## D. 思考狀態（thinking / reasoning）

| # | 設計點 | 要規範什麼 | 參考 | 現況 |
|---|--------|-----------|------|------|
| D.1 | 等待指示 | 尚無任何輸出時的 spinner + 文字 | — | ✅ 「Thinking…」 |
| D.2 | reasoning 即時展示 | `.sc-think` 收合但帶即時尾行預覽 + shimmer | Gemini「Show thinking」、claude.ai 思考面板 | ✅ Batch 3 |
| D.3 | 完成後摘要 | `Thought for Ns`（UI 量測，live-only；歷史退化為 `Thought`） | ChatGPT / Gemini | ✅ Batch 3 |
| D.4 | 多階段狀態文字 | `statusLine()` **由 run 狀態推導**（job／待回應／執行中工具名／步數），不做假字串輪播 | Gemini deep research | ✅ Batch D |
| D.5 | 動效 | shimmer + reduced-motion 退化（整條關閉而非放慢） | — | ✅ Batch 3 |

## E. 執行狀態（tool / job / agent）

| # | 設計點 | 要規範什麼 | 參考 | 現況 |
|---|--------|-----------|------|------|
| E.1 | 單一 tool call | glyph／spinner 狀態欄（固定 12px）+ 名稱 + 靠右耗時 | Claude Code 的 tool 行 | ✅ Batch 3 |
| E.2 | tool call 群組 | 執行中顯示 `Running tools n/N · name…` 並只露出當前那顆；完成後收合為總耗時 | — | ✅ Batch 3 |
| E.3 | 失敗與重試 | failure pill 已有；單一 call 的錯誤詳情、retry 動作 | — | 🟡 |
| E.4 | 背景 job | job chip（id、狀態、spinner）；缺單一 job 的進度與取消（現在只有全域 Stop） | — | 🟡 `.sc-jobchip` |
| E.5 | plan / todo | runtime 綁定的任務清單（進行中高亮、完成打勾），非僅靜態 checklist 卡 | Claude Code TodoWrite、Cowork 任務面板 | 🟡 checklist/progress 卡可充當 |
| E.6 | 子代理 / 巢狀活動 | subagent 的活動如何巢狀顯示、標籤 | Claude Code subagent 行 | ❌ |
| E.7 | HITL 卡 | confirm / choice / form；**永不收合**（"a hidden deposit form is an unreachable deposit form"）；answered 後 disable | — | ✅ 規則與實作都在 |
| E.8 | 權限請求 | allow once / always / deny 的樣式（比一般 confirm 更重的語氣） | Claude Code permission prompt | ❌ |
| E.9 | 產出物 | 檔案交付 chip / 卡（檔名、大小、下載、預覽） | Cowork outputs、ChatGPT 檔案卡 | ❌ |
| E.10 | 即時 log 視圖 | 長任務的 streaming log（終端輸出、自動捲動、等寬） | Claude Code、Cowork | ❌ |
| E.11 | 執行摘要 | 併入 `.sc-msgmeta`：耗時 · 步數（>1 才顯示）· model · tokens | Gemini deep research 報告頭 | ✅ Batch A+B |

### 執行不了的項目，以及缺什麼（2026-08-04 盤點）

這些不是沒做，是**做不了**——runtime 沒有對應概念，硬做出來的 UI 會是假的。

| # | 缺的東西 | 為什麼不硬做 |
|---|---------|-------------|
| A.5 版本與分支 | `AgentClient` 的 `messages` 是一維陣列，沒有訊息樹；`regenerate()` 直接截斷重跑 | 分頁器要能來回切換版本，需要保存被丟棄的分支。做成假的 ‹1/2› 只會在重載後消失 |
| E.3 單一 call retry | runtime 沒有「重跑某一個 tool call」的入口，工具執行綁在 agent loop 裡 | 錯誤詳情已可展開看；retry 按鈕若只是重跑整個 turn，就是掛羊頭 |
| E.4 單一 job 取消 | `stop()` 是全域 abort，`JobStore` 沒有 per-job cancel | 一個取消不了的取消鍵比沒有更糟 |
| E.5 runtime plan/todo | runtime 沒有任務清單概念，checklist/progress 是**模型產生的卡**而非執行狀態 | 要做真的，得先在 core 定義 plan 的生命週期事件 |
| E.6 子代理巢狀 | runtime 沒有 subagent 概念，事件流是平的 | 沒有巢狀資料就畫不出巢狀 UI |
| E.10 即時 log 視圖 | 沒有 log 串流通道；工具只在結束時回傳一次 output | 需要 core 開一條 `tool-log` 事件 |
| F.1 thread 側欄 | **thread 持久化完全不存在**（`AgentClient` 訊息在記憶體，只有 `JobStore` 有持久層） | 側欄的內容就是持久化的對話列表，前置不在則整項落空 |
| F.4 分享連結 | 需要後端存放與短連結 | 匯出（markdown 下載）已做；分享用 data: URL 是自欺 |

HANDOFF 的專案級待辦中，**thread 持久化**是卡住最多 UI 項目的一個
（F.1、F.4 的分享、以及 A.9 章節標記的長期價值都壓在它上面）。

## F. 訊息流之外（shell 周邊）

暫列存目，不在四大點內，之後再議優先序。

| # | 設計點 | 參考 | 現況 |
|---|--------|------|------|
| F.1 | thread 側欄（列表、搜尋、改名、資料夾） | Open WebUI / ChatGPT | ❌（playground 是 dev panels，非產品；且 thread 持久化本身未做） |
| F.2 | context / usage 檢視 | — | ✅ `ContextInspector` |
| F.3 | toast / 全域錯誤 / 斷線重連 | — | ✅ Batch D：`ToastProvider`（事件，自動消失）+ `ConnectionBanner`（狀態，不自動消失） |
| F.4 | 對話分享 / 匯出 | ChatGPT share | 🟡 Batch D：`threadToMarkdown`／`downloadThread` 已做；分享需後端，未做 |
| F.5 | 主題切換 | — | ✅ tokens 已支援 `[data-theme]` |

---

## 觀察與建議切入點

1. **Quick wins（缺陷級，先修）**：C.2 IME 組字誤送出、A.2 thread 內
   markdown 渲染、A.6 錯誤狀態沒有 UI、C.1 auto-grow。→ 修理中（Batch 1）。
2. **四大點裡最值得先展開的規範**：0.2/0.3（spacing、字級 tokens——
   B/C/D/E 全部壓在它上面）、E.1（per-call 狀態是 agentic UI 的核心觀感）、
   D.2/D.3（thinking 的即時感）。→ 已展開為下方 Phase 2。
3. ~~先開瀏覽器看一次~~ 已完成目視。

---

# Phase 2 — 基礎規範（草案 v0）

2026-08-04。值是從現況 CSS 收斂出來的決定，不是憑空另起爐灶；
與現況衝突處標「遷移」。待審後進入 Phase 3 實施批次。

## 規範原則

1. **零依賴**：`packages/ui` 不引入 icon 庫、動畫庫、markdown 庫。
   裝飾用字元 glyph、動效用 CSS、markdown 用內建的 escape-first 渲染器。
2. **Border-first flat**：層次靠邊框與底色（surface / surface-2），不靠陰影。
   陰影只保留給真正的浮層（dropdown / modal / toast）。
3. **顏色只走 tokens**：任何元件不得出現 raw hex；tone 一律
   positive / negative / warning / info 四語意 + accent。
4. **非顏色訊號**：每個用顏色表達的狀態都要有第二訊號
   （glyph、文字、邊框樣式），色盲環境不失義。
5. **Reduced-motion 是一等公民**：每加一個動效，同一個 PR 要寫它的
   `prefers-reduced-motion` 退化。

## 2.0 Tokens

### 2.0.2 間距 scale（新增）

以 px 值命名（自我說明，查表零成本）：

```css
--sc-sp-2: 2px;  --sc-sp-4: 4px;  --sc-sp-6: 6px;  --sc-sp-8: 8px;
--sc-sp-10: 10px; --sc-sp-12: 12px; --sc-sp-16: 16px; --sc-sp-20: 20px;
--sc-sp-24: 24px; --sc-sp-32: 32px; --sc-sp-48: 48px;
```

用法規則：

| 層級 | 值 |
|------|----|
| 元件內 glyph↔文字、pill 內距 | 4 / 6 |
| 元件內欄位間、按鈕 gap | 6 / 8 |
| 卡片內段落間、actions 上緣 | 10 / 12 |
| 卡片 padding | **12 × 16**（現況 14×16 → 遷移） |
| 卡片與卡片、訊息元素之間 | 12 |
| 訊息與訊息之間 | 20 |
| thread 外框 padding | 20 |
| 空狀態、大留白 | 48 |

遷移規則：現有奇數值就近吸附（7→8、9→8、11→12、13→12、14→12 或 16）。
圖表 SVG 內部座標豁免。

### 2.0.3 字級與字重

```css
--sc-fs-11 / --sc-fs-12 / --sc-fs-13 / --sc-fs-14 / --sc-fs-22 / --sc-fs-26
--sc-lh-tight: 1.25;  /* 大數字、stat value */
--sc-lh-ui: 1.4;      /* 標籤、按鈕、chip */
--sc-lh-prose: 1.6;   /* 訊息本文、callout body */
```

| 用途 | 字級 | 字重 |
|------|------|------|
| meta / overline / pill / footnote | 11 | 400（overline 加 uppercase + letter-spacing 0.04em） |
| 輔助文字、detail、表頭 | 12 | 400；表頭 600 |
| UI 預設（卡片內文、按鈕、表格） | 13 | 400；標題 600、強調 500 |
| 訊息本文、composer | 14 | 400 |
| stat 數值 | 22 | 600 |
| gauge 主數值 | 26 | 600 |

字重只用 400 / 500 / 600，禁 700（現況 callout icon 的 700 → 遷移為 600）。
所有數據數字一律 `font-variant-numeric: tabular-nums`。

### 2.0.5 動效

```css
--sc-dur-1: 120ms;  /* hover、按鈕狀態 */
--sc-dur-2: 240ms;  /* 寬度/高度變化、進場 */
--sc-dur-3: 400ms;  /* 面板展開收合 */
--sc-ease-out: cubic-bezier(0.2, 0, 0, 1);      /* 進場 */
--sc-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1); /* 尺寸變化 */
```

- 進場：streaming 中新出現的卡片/狀態條用 fade + 4px 上移，dur-2 ease-out。
- **無退場動畫**——內容上移補位比退場動畫重要，退場一律瞬時。
- spinner 維持 700ms linear；shimmer 週期 1.2s。
- reduced-motion：transition 全歸零、shimmer 靜態化（維持 muted 色）、
  spinner 放慢到 2s（現況已做）。

### 2.0.6 圖示（glyph 制）

不引入 icon 庫。canonical glyph 表——**只准用這些，新增要先進表**：

| glyph | 語意 | 出現處 |
|-------|------|--------|
| ▸ / ▾ | 收合 / 展開 | tools chip、reasoning 條、tree |
| ○ | pending | step、call |
| ◐ | active（無動畫場合） | step |
| ● | done | step、call、timeline dot |
| ✕ | failed | step、call |
| – | skipped / n.a. | step、checklist |
| ↑ / ↓ | 排序方向 | 表頭 |
| ＋ / − | diff 增刪 | diff 卡 |

規則：glyph 一律 `aria-hidden` 且旁邊有文字（或 sr-only）；清單場合
glyph 欄固定寬（12px）保持對齊；**不用 emoji**。

### 2.0.7 層級與陰影

```css
--sc-z-base: 0;  --sc-z-sticky: 10;   /* composer、吸底列 */
--sc-z-menu: 20; /* dropdown、mention 選單 */
--sc-z-toast: 30; --sc-z-modal: 40;
--sc-shadow-overlay: 0 8px 24px rgb(0 0 0 / 0.16);  /* dark: / 0.5 */
```

浮層（menu 以上）才有陰影；所有 in-flow 元素維持 border-only。

## 2.A 訊息流與空狀態（參考整合）

從五張參考截圖（Canva AI 首屏／思考態、Sprout 對話、Gemini 首屏／思考態）
抽出的共同規律，作為 A/C/D 章規則的依據：

| # | 規律 | 樣本 |
|---|------|------|
| R1 | 空狀態把 composer 當主角：大字問候（問句、可個人化）置中 + composer 置中 + 建議 chips 直接掛在 composer 下方 | Canva、Gemini |
| R2 | composer 是獨立圓角卡片、不是貼邊 bar；槽位語意固定——左 = 加內容（+）、右 = 送出與輸入方式（mic/send）、模型選擇貼著輸入區（單列時右內、雙列時下左） | Canva、Gemini、Sprout |
| R3 | 助理回覆下緣一行 muted meta：耗時 · 費用 · 模型 · 重跑 | Sprout |
| R4 | 等待指示極輕、status 文字用「正在…」動詞句；最簡形是三點 | Gemini、Canva |
| R5 | 使用者訊息深／強色右對齊，助理淺色或無底左對齊 | 全部（kit 現況同構） |

### A.7 空狀態（規範）

- 結構（垂直置中，上到下）：**問候 headline**（26/600、問句語氣、
  host 可個人化）→ **composer**（置中，寬度上限 640）→
  **starter chips 列**（gap sp-8）。
- starter chip：高 32、13px、glyph + 文字，`sc-pill` 的放大形
  （新增 `.sc-starter`）；點擊 = 預填 composer 或直接送出，由 host 決定。
- 出現第一則訊息後整組退場（瞬時、無動畫，v1），composer 回到吸底位。
- kit 只給樣式與 slot（`empty` prop 已在），文案與 chips 內容一律 host 給。

### A.10 助理 meta 行（規範，依 R3）

- 完成的 assistant turn 下緣一行 11px muted：`{耗時}s · {model}`；
  可選插槽：tokens / cost（待 core 暴露 usage——列待辦）。
- 行尾 actions **常駐**（不做 hover 才浮現，觸控裝置吃虧）：copy、
  regenerate，`sc-btn--ghost sc-btn--sm`。
- streaming 中不顯示；error turn 不顯示（error 區塊自帶 retry）。

## 2.B 卡片與裝飾性物件

**解剖**（自上而下，全部可選）：`head`（title 13/600 + 右側最多 2 個
pill）→ `prompt/body` → `caption`（12 muted）→ `footnote`（12 muted）→
`actions`（上緣 sp-12，gap sp-8）。

- 卡片 padding 12×16、圓角 `--sc-radius`、卡間距 12、無陰影。
- **tone 邊框公式統一**：`color-mix(tone 45%, var(--sc-border))`（現況已是，成文化）。
- 裝飾物分工：**pill = 狀態與 metadata**（不可當按鈕）；**callout = 卡內
  唯一的區塊級強調**（不可巢狀在另一個 callout / 強調區塊內）；
  divider 用 `1px var(--sc-border)`，一張卡最多一條。
- 數字欄右對齊 + tabular-nums；文字欄左對齊；置中只給 comparison 矩陣。
- **Loading 骨架（新增）**：三條 shimmer bar（標題 40%、內容 100% / 80%），
  延遲 200ms 才出現（避免閃爍）、一旦出現至少停留 300ms 再換內容。
- 五態齊備：loading（新增）/ ready / render 失敗（CardBoundary）/
  未註冊 kind（unrendered + raw JSON）/ expired。後三者現況已有，不動。
- 截斷：`sc-pre` 類最高 220px 內捲；表格 > 30 列收成「Show all (N)」；
  寬內容一律在卡內 `overflow-x: auto`，**永不撐破 thread 橫向**。

## 2.C 聊天框

**結構（槽位制，依 R2）**：composer 是獨立圓角面（`--sc-radius`、
1px border、bg surface、`--sc-z-sticky`），不是貼邊 bar。

- 單列（現況，無 accessory）：`[+ 附件（未來）] [textarea] [Send｜Stop]`
- 雙列（任一 accessory 啟用時自動升級）：上列 textarea 全寬；
  下列左 = **model picker**（ghost 樣式），右 = 工具 toggles + Send。
- 槽位語意固定：**左 = 加內容、右 = 送出與輸入方式、模型／模式貼著
  輸入區**——不另設頂部工具列（C.5 的位置之爭就此定案）。

- textarea：min-height 40 / max-height 180、auto-grow、`resize: none`、
  14 / lh-prose、focus ring `2px accent inset`（現況）。
- **鍵盤表**：Enter 送出；Shift+Enter 換行；**組字中（isComposing /
  keyCode 229）Enter 永不送出**；Esc 在 running 時 = Stop。
- 按鈕狀態機：空值/純空白 → Send disabled；running → 換 Stop（ghost），
  輸入框保持可編輯；**running 中不排隊**（v1 決定，簡單優先）。
- 附件（Phase 3 後段）：chips 列於輸入框上方，高 32、含檔名+大小+移除+
  上傳進度；拖放與貼上圖片都落到同一條 chips 列。

## 2.D 思考狀態

**狀態機**：`waiting`（無任何輸出：spinner + "Thinking…"）→
`reasoning`（思考條出現，即時預覽）→ `answering`（本文開始 stream，
思考條收合成摘要）→ `done`（"Thought for Ns"）。

**等待指示分級（依 R4）**：kit 預設 = spinner + status 文字；文字用
「正在…」動詞句，接 D.4 的輪替槽位。純三點的極簡形與品牌 orb／avatar
屬 host 裝飾層，kit 不內建——裝飾換皮不該動到狀態機。

**資料前置**：reasoning 沒有任何時間戳事件，`Thought for Ns` 的 N 只能由
UI 自行量測（首個 `reasoning-delta` → 首個 `text-delta` 的 wall-clock）。
因此**時長是 live-only**：重載的歷史對話沒有 N，摘要行退化為
`Thought`（仍可展開）。不為了這個把時間寫進 message metadata——
一個裝飾性數字不值得擴張持久化格式。

**DOM 契約**（批次 3 實作）：

```
.sc-think                     ← 取代現行 .sc-reasoning
  button.sc-think__head       ← 整行可點，aria-expanded
    span.sc-think__icon       ← ▸ / ▾（aria-hidden）
    span.sc-think__label      ← "Thinking…" | "Thought for 12s" | "Thought"
    span.sc-think__peek       ← 尾行預覽，單行 ellipsis；僅 streaming 中
  pre.sc-think__body          ← 展開時；max-height 260 內捲
```

`.sc-think--live` 時 label 掛 shimmer。狀態由 `run.status` 與是否已有
text part 推導，不新增 store 欄位。

**思考條解剖**（一行，12px muted）：
`[▸/▾] Thinking…（shimmer） — 最後一行即時預覽（單行 ellipsis）`

- 預設收合但**帶即時尾行預覽**（Gemini 式）；點開 → 全文，
  max-height 260 內捲（現況值），dur-3 ease-in-out 展開。
- 完成後 label 換成 `Thought for {N}s`（N = 首個 reasoning delta 到
  首個 text delta 的秒數），預覽行消失，仍可展開。
- shimmer 只在 reasoning streaming 中出現；reduced-motion → 靜態 muted。

## 2.E 執行狀態

**資料前置（批次 3 的第一步，必須先做）**：`tool-result` **事件**帶了
`ms: number`，但 reducer 在寫入 part 時把它丟掉了，`ContentPart` 的
tool-result 型別也沒有這個欄位——所以耗時目前在 UI 端拿不到。

修法（小且正確，資料本來就在）：`ContentPart` 的 tool-result 加
`ms?: number`，reducer 的 `tool-result` case 一併寫入。因為 `commitRun`
是把 `run.parts` 原樣折進 assistant message，這一改**同時**讓 live 與
重載後的歷史都有耗時，不需要第二套機制。這點與 D.3 不同——那邊沒有
現成資料，這邊只是撿回被丟掉的。

**單一 call 生命週期**（glyph 依 2.0.6）：
`○ pending → [spinner] running → ● done（右側 muted 耗時） → ✕ failed（+ failure pill）`

- **成功是預設，不慶祝**：done 用 muted，不用 positive 綠——
  綠色留給 step/checklist 這種「進度達成」語意。
- call 行：`[glyph 12px 固定寬] name（mono 12） …右緣耗時`；
  args 一行截斷、點開才是 `sc-pre`；result 同。
- **群組行為**：running 中 chip 顯示活動計數「Running tools 2/3 · {name}…」
  並在 chip 下方露出**當前這一顆** call 的行（不整組展開）；
  完成後全收合為「N tool calls · {總耗時}」+ failures badge（現況樣式）。
- 背景 job chip：spinner + label + status pill + 已耗時；
  job 級取消按鈕（Phase 3，等 core 支援單 job cancel）。
- **不變式（重申，最高優先）**：interactive card（confirm/choice/form）
  永不收合、永不被自動回答、answered 後 disable。

### E.7-bug — transcript 謊報使用者的決定（✅ 已修，2026-08-04）

瀏覽器實測發現：按下「Create alert」→ 警報確實建立（另一張卡有
`alert_SUI_5`），但同一張 confirm 卡在 turn 結束後顯示 **「Declined.」**。
這直接違反 `Interactive.tsx` 檔頭自己寫的不變式（「答完後留著，
讓 transcript 記錄使用者實際選了什麼」）。

**成因**：答案只活在 component 的 local state。run 結束時 `commitRun`
把卡片折成 artifact part，`MessageView` 用 `answered` 重新掛載一個**全新
實例**——local state 沒了，於是：

| 卡 | 重掛後顯示 | 實際 |
|----|-----------|------|
| confirm | 一律「Declined.」（三元運算的 fallback 分支） | 可能是 confirmed |
| choice | 沒有任何選項是選取狀態 | 使用者選過 |
| form | 顯示 `spec.fields` 的**預設值** | 使用者填的值 |

form 那格最危險：它看起來像使用者送出了預設值。

**資料在，只是被丟掉**（與 E.1 的 `ms` 同一個模式）：`user-responded`
事件帶著完整的 `action`，reducer 的該 case 只清掉 `pendingCard`，
把 action 丟棄。

**修法**（批次 3 實作，需含測試）：

1. `Card` 加 `action?: CardAction`。
2. reducer 的 `user-responded`：依 `callId` 把 action 掛到對應的 card 上。
3. `commitRun` 的 artifact `data` 改帶 `{ spec, action }`（現在只帶 spec），
   `Thread.partsOf` 對應讀回。**不做舊格式相容**——尚未有持久化層出貨，
   為一個沒有使用者的格式背相容債不划算。
4. 三個 renderer 改為**優先讀 `card.action`**，local state 只服務
   「送出後、run 結束前」這段空窗。confirm 讀 `action.type`、
   choice 讀 `action.value.selected`、form 讀 `action.value`。

**規範（通則）**：凡是「使用者做過的動作」，UI 一律以持久化資料為準，
local state 只能當尚未落地前的暫態。任何在 fallback 分支**斷言**某個
結果的三元運算都是這個 bug 的溫床——不知道就顯示中性文字，不要猜。

**實作結果**：四層照上述修法改完，`confirm` 另補「decision 不明 →
中性 `Answered.`」分支，choice/form 的收尾文案也依 action 分辨
（`Skipped.` / `Cancelled.`）。core 加 2 個回歸測試（confirm 與 cancel
各一，斷言 action 落在 card 上），共 119 passed。瀏覽器覆驗：按下
Create alert 後 transcript 顯示 `Confirmed.`（positive 色）。

**DOM 契約**（批次 3 實作，沿用現有 `.sc-tools*` 命名）：

```
.sc-tools
  button.sc-tools__head       ← 收合切換
    span.sc-tools__icon       ← ▸ / ▾
    span.sc-tools__summary    ← "Running tools 2/3 · fetchPrice…" | "3 tool calls · 1.4s"
    span.sc-pill--negative    ← 失敗數，僅 failures > 0
  ul.sc-tools__list           ← 展開時全部；running 時只掛當前那一顆
    li.sc-tools__item
      span.sc-tools__status   ← glyph 或 spinner，固定寬 12
      code.sc-mono            ← 工具名
      span.sc-tools__ms       ← 耗時，右緣 muted，僅 done/failed
```

耗時格式：`< 1000ms` 顯示 `{n}ms`，否則 `{n.n}s`。群組總耗時 = 各 call
`ms` 相加（非 wall-clock，因為工具可能並行——標示為總計而非經過時間）。

## 標準化完成聲明（2026-08-04）

四大點的**標準化**到此完成：0.x tokens、B 卡片、C 聊天框、D 思考狀態、
E 執行狀態，全部有規範、有實作、有瀏覽器實測。120 tests / 4 專案
typecheck 全綠。

**仍是 ❌ 但不屬於標準化的項目**——它們是「還沒有的功能」，不是「已有
但沒規範的行為」，混進標準化只會讓完成的定義失焦：

- A.3 streaming 游標、A.4 訊息操作列、A.5 版本分支、A.9 日期分隔、
  A.10 meta 行：都是新增的訊息流功能。
- C.4 附件、C.5 模型選擇、C.6 工具開關、C.7 slash、C.8 @ 提及、
  C.9 長度提示：composer 的新功能，各自需要協定與資料來源決策。
- D.4 多階段狀態文字、E.5 plan/todo、E.6 子代理、E.8 權限請求、
  E.9 產出物、E.10 即時 log、E.11 執行摘要：都需要 runtime 先送出
  對應事件，UI 無中生有不了（與 D.3 的取捨同理）。
- F 全章（側欄、toast、分享）：thread 之外的 shell。

**判準**：標準化 = 把既有行為收斂成可依循的規則；新功能 = 需要先決定
它該存在與如何運作。前者已完成，後者另案。

**Phase 4（設計）是另一條佇列，不是這條的續集**，編號用 D1/D2/D3 以免
被讀成接在批次 4 後面。D1、D2 已實作（順序上先做了，是錯的），D3 未做
且不排在任何待辦之前。

## Phase 3 — 實施批次

| 批次 | 內容 | 狀態 |
|------|------|------|
| 1 | Quick wins：IME、auto-grow、error UI、thread markdown | ✅ 完成並瀏覽器驗證 |
| 2 | Token 化：2.0.2/2.0.3/2.0.5/2.0.7 寫入 styles.css 並全檔遷移 | ✅ 完成並瀏覽器驗證 |
| 3 | **E.7-bug（transcript 謊報決定）** → E per-call 狀態 + 群組行為 → D 思考條 | ✅ 完成並瀏覽器驗證 |
| 4 | Composer 擴充：Esc=Stop、卡片骨架 | ✅ 完成並瀏覽器驗證 |
| — | 附件槽位（C.4） | 移出標準化：見下方說明 |

### Batch 4 結案紀錄（2026-08-04）

**Esc = Stop**（C.10）：同樣加上組字防護——Esc 是 IME 取消候選字的按鍵，
那一下不能順手把整個 turn 也殺掉。驗證方式是**對照實驗**：分別用 Stop
按鈕與 Esc 各跑一次，兩者都得到 `run-finish cancelled · 1 step(s)`，
證明接線正確。過程中一度誤判 Esc 失效，實際是 demo 工具的 `setTimeout`
不理會 abort signal，UI 當然不會立刻停——**驗證失敗時要先確認測具本身**。

**卡片骨架**（B.5）：`CardSkeleton` 已匯出。延遲 200ms 才出現（閃一下就
消失的骨架比沒有更糟），bar 用 shimmer，`aria-busy` + sr-only「Loading…」
——bar 沒有文字，不加標籤會被輔助技術讀成一張空卡。同時補上 kit 先前
沒有的 `.sc-sr-only` 工具類別。

**`.sc-skeleton__bar` 與思考條的 shimmer 都寫了 reduced-motion 退化**，
經 CSSOM 檢查確認四條規則都在 media query 內。

**附件槽位（C.4）不屬於標準化**：它需要決定上傳協定、預覽尺寸、
錯誤處理與 `ContentPart` 的檔案型別如何在 composer 表達——那是新功能
設計，不是把既有行為規範化。標準化階段到此為止；附件另案處理。

### Batch 3 結案紀錄（2026-08-04）

`ms` 撿回：`ContentPart` 的 tool-result 加 `ms?`、reducer 一併寫入，
因 `commitRun` 原樣折進訊息，live 與歷史同時有耗時。`ToolActivity`
與 `ThinkBlock` 依 DOM 契約重寫，`.sc-reasoning` 全面汰換為 `.sc-think`。

**驗證方法值得記錄**：demo transport 的工具是瞬時完成、也不產生
reasoning，所以「執行中」與「思考中」這兩個狀態在正常操作下**永遠
一閃而過**——實作了卻沒人看過，正是批次 1 那個崩頁 bug 的成因。
因此採取**暫時注入、驗完還原**：先在一個 demo 工具塞 2.5s 延遲觀察執行中，
再往 demo transport 注入 reasoning deltas 並放慢到 700ms 觀察思考條，
兩者都以 `git checkout` 還原（含被 Python 寫檔改掉的行尾）。

實測結果：
- 執行中 → `Running tools 0/1 · reviewContract…`，該列帶 spinner，
  且 `aria-expanded="false"`——**沒有展開整組**就露出當前那顆，符合規範。
- 完成後 → `1 tool call · 2.5s`、`2 tool calls · 67ms`；展開後每列為
  `● reviewContract 56ms`，glyph 固定 12px 欄對齊、耗時靠右。
- 思考條 → `Thinking…`（shimmer 生效）+ 尾行預覽逐句更新
  → 收成 `Thought for 3s`。

### Batch 1 結案紀錄（2026-08-04）

實作：`markdown.ts`（從 Basic.tsx 抽出、加 fenced code 保護）、Thread 的
IME guard／auto-grow／ErrorBlock、`client.ts` 的 commitRun 狀態保留。
測試 117 passed，瀏覽器實測 markdown 渲染成真 `<p>`、auto-grow 40→180→40、
error 卡與 Retry 皆正常。

三個 review 抓出、subagent 沒發現的問題（值得記住的模式）：

1. **Rules of Hooks 崩頁**：`useMemo` 被加在 `LiveTurn` 早退 return 之後，
   run 一開始 hook 數就變動，整頁白畫面。**規範：hook 一律在早退之上**。
2. **href 屬性逃逸**：`renderMarkdown` 只 escape `< > &`，URL 內的 `"`
   可關閉 href 屬性夾帶 `onmouseover`。已補 `&quot;` 與回歸測試。
   **規範：值進 HTML 屬性就必須 escape 引號**。
3. **run-finish 蓋掉 error**：reducer 無條件寫 `status:"done"`，
   使得失敗的 run 在 UI 看起來成功。已改為依 `finishReason` 判定
   （cancelled → done，error → error），並補 3 個 reducer 終態測試。

### Batch 2 結案紀錄（2026-08-04）

204 處硬編碼值換成 token。驗證方式：因為 CSS 不進 typecheck、測試也
照不到樣式，改用**腳本 + 瀏覽器 computed style** 雙重確認——
腳本掃出 34 個被使用的 token 全部有宣告（缺一個就會讓整條宣告靜默失效）、
括號 212/212 平衡；瀏覽器實測 card padding `12px 16px`、pill line-height
`15.4px`（11×1.4）、訊息本文 `22.4px`（14×1.6）、composer `sticky` z-index 10、
22 張卡無一橫向溢出、dark 模式 token 正常切換且 shadow 取到 0.5 alpha 版本。

補完 agent 遺留的半完成狀態：`--sc-lh-*` 三個 token 原本宣告了卻無人使用，
依規範接上 `.sc-stat__value`（tight）、`.sc-msg__text` 與 `.sc-callout__body`
（prose）、`.sc-pill`（ui）。程式碼字型的 1.5 與 gauge 的 1.1 維持不動——
規範沒有涵蓋等寬與量表幾何。

刻意保留未消費的 token：`--sc-sp-24/32`、`--sc-z-menu/toast/modal`、
`--sc-shadow-overlay`、`--sc-dur-3`、`--sc-ease-out`——都是批次 3/4
（浮層、思考條展開、進場動畫）的前置，先宣告不算浪費。
`--sc-series-*` 由 `Chart.tsx` 以 `var()` 字串消費，不在 CSS 內出現。

---

# Phase 4 — 設計（v0 決策）

2026-08-04。**規範化 ≠ 設計**：Phase 2 是把既有數值吸附到尺規上，讓它
一致；沒有人決定過那個「既有樣貌」該長什麼樣。本章補上真正的設計決策。

**已定立場**：有主張的好看預設 + 全可換皮。推論出的硬性約束——
**視覺不得寫死在規則裡，一律走 token**；host 覆蓋 token 就能整體改觀，
不需要改一行元件程式碼。這條約束直接決定了下面 4.1 的做法。

## 4.1 Token 的角色化（結構性前提）

Phase 2 的字級 token 用數值命名（`--sc-fs-14`）。這在設計階段就壞了：
只要密度決策把本文從 14 改成 15，token 名字就開始說謊，host 也無從
知道哪個 token 代表「本文」。**值命名的 token 擋住設計迭代**。

改為角色命名（本章其餘決策都建立在這之上）：

```css
--sc-fs-body:  15px;  /* 訊息本文、composer */
--sc-fs-ui:    13px;  /* 卡片內文、按鈕、表格 — UI 預設 */
--sc-fs-meta:  12px;  /* 輔助說明、detail、表頭 */
--sc-fs-micro: 11px;  /* pill、overline、footnote */
--sc-fs-stat:  22px;  /* stat 數值 */
--sc-fs-hero:  26px;  /* gauge 主數值 */
```

間距維持數值命名——它是尺規不是決策，host 要調的是個別元件而非整條尺規。

## 4.2 字體（本專案從未決定過）

kit 目前**沒有任何 sans 宣告**，字體是跟著 host 繼承來的。這是觀感最大的
槓桿卻從未被選擇。

```css
--sc-sans:
  "Inter", "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont,
  "Helvetica Neue", Arial, Roboto,
  "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Hiragino Sans",
  ui-sans-serif, system-ui, sans-serif,
  "Apple Color Emoji", "Segoe UI Emoji";
```

**排序規則：明確的 Latin 字體 → CJK 字體 → 泛型關鍵字，泛型必須墊底。**

這條規則是實測出來的，不是推導的。初版把 `ui-sans-serif, system-ui`
排在第二、三位，瀏覽器實測發現**所有 Latin 文字都掉進 Microsoft
JhengHei**（量測寬度與 JhengHei 完全相同）——因為 `system-ui` 是**依
OS 語系解析**的，在繁中 Windows 上它就是 JhengHei，而 JhengHei 的
Latin 字形很弱。等於我為了防「中文掉進 Latin 字體」寫的那行，反而造成
了「Latin 掉進中文字體」。

泛型關鍵字的解析結果不可預期，所以不能排在明確選擇前面。修正後實測：
Latin 落在 **Segoe UI Variable Text**、CJK 落在 JhengHei，中英混排字串
的寬度介於兩者之間——證明兩段文字各自用了對的字體。

**另一條**：值裡面不可以寫註解。custom property 會把註解保留在 token
流中，host 讀回 `--sc-sans` 會連註解字串一起拿到——對一個以「覆蓋 token
換皮」為賣點的 kit，這會直接破壞契約。註解一律寫在宣告之外。

**不載入 webfont**——kit 是純 CSS、零依賴、可離線，拉 Google Fonts 會
破壞這三點並踩到嚴格 CSP。Inter 排第一是「host 有就用、沒有就退回系統」，
不強加網路成本。CJK 明確列出繁中字體，因為中英混排時中文掉進預設字體
是最常見也最醜的失誤。

光學調整：`--sc-fs-stat` 以上加 `letter-spacing: -0.01em`（大字視覺過鬆）；
overline 維持 `+0.04em`；數據一律 `tabular-nums`（Phase 2 已做）。

## 4.3 密度：對話優先

主要活動是閱讀，不是掃描儀表板。

| 項目 | 原 | 新 | 理由 |
|------|----|----|------|
| 訊息本文 | 14px / 1.6 | **15px / 1.7** | 各家聊天產品都在 15–16；1.7 讓長段落好讀 |
| 訊息間距 | 20 | **24** | 加大發話輪替的呼吸 |
| 卡片內文 | 13px | 13px（不變） | 卡片要保留資訊密度，與本文刻意拉開層級 |

**設計主張**：對話放鬆、卡片收緊。兩者的密度差本身就是層次——
卡片因此讀起來像「嵌在對話裡的一塊資料」，而不是另一段話。

## 4.4 色彩：accent 節制

現行 `#3a6df0` 是預設藍，沒有個性；但真正的問題不是色相，是**用量**。

**使用者氣泡目前是整塊飽和藍**——這是全畫面最大的色塊，它會跟卡片
搶注意力，觀感也偏舊（iMessage 時代語彙）。Claude、Gemini 都已改用
中性氣泡。

改：使用者氣泡改為 `--sc-surface-2` 底 + 1px border，文字用一般 text 色。

**accent 節制規則**：accent 只用於——primary 按鈕、focus ring、連結、
hover／選取／進行中等**互動或狀態**訊號。**不得**用於氣泡、資料強調、
裝飾性填色、標題。色彩的說服力來自稀缺；到處都是 accent 等於沒有 accent。

**規則的適用範圍**（實作時發現需要界定）：稀缺性是相對於**同一個表面**
而言的，規則因此只約束 **thread 表面**。`ContextInspector` 之類的獨立
面板是另一個表面，有自己的預算——那裡的 bar 用 accent 不與任何東西
競爭。反例：`.sc-compare__best` 原本用 accent 8% 填色標示「最佳」欄，
但它在 thread 表面上，而且是**資料強調不是可點擊**，已改為中性
`--sc-surface-2`。判準就是這個：**這塊顏色在暗示可以動它嗎？**

## 4.5 形狀

```css
--sc-radius:    12px;  /* 卡片、composer 等面（原 10） */
--sc-radius-sm:  8px;  /* 按鈕、輸入框、選項（原 6） */
--sc-radius-xs:  4px;  /* 行內 code、swatch、序號方塊 */
```

略微放軟，與 4.3 的放鬆一致。氣泡保留不對稱尾角（`12px 12px 4px 12px`）
——它是歸屬感的視覺線索，換成中性色後更需要這個線索。

## 4.6 層次：border-first，但 composer 例外

in-flow 元素一律 border-only（好換皮、深淺色都穩）。唯一例外是
**composer**：它 sticky 疊在內容上，只靠 border 會讓文字從底下穿出來。

規則：內容捲動到被遮住時才浮現向上陰影，捲到底時消失——
陰影是**狀態指示**（下面還有內容），不是裝飾。

## 4.7 動效個性：快而不搶戲

Phase 2 的進場 240ms 對一個**持續 streaming** 的介面太慢——每顆 token、
每張卡都在動，慢動畫會累積成拖沓。

```css
--sc-dur-1: 120ms;  /* hover */
--sc-dur-2: 160ms;  /* 進場、尺寸變化（原 240） */
--sc-dur-3: 320ms;  /* 面板展開收合（原 400） */
```

維持「無退場動畫」。個性定調：**快、短、不彈跳**——不用 overshoot／
spring，agent 介面的可信度來自穩定，不是活潑。

## 4.8 實施批次

**這是與 Phase 3 各自獨立的佇列，編號另起。** 原本沿用 1–4 往下編成
5/6/7，讀起來像「批次 4 之後就輪到批次 7」——把設計混成標準化的續集，
而兩者的完成定義並不相同。編號本身就是一種宣稱，所以改掉。

| 批次 | 內容 | 狀態 |
|------|------|------|
| D1 | 4.1 角色化 token + 4.2 字體 + 4.3 密度 | ✅ 完成並瀏覽器驗證 |
| D2 | 4.4 色彩節制（氣泡改中性）+ 4.5 形狀 + 4.7 動效值 | ✅ 完成並瀏覽器驗證 |
| D3 | 4.6 composer 捲動陰影（需 scroll 狀態） | 未做 |

D1／D2 於標準化尚未完成時就先做了，順序上是錯的（使用者事後明確要求
標準化優先）。D3 未做，且**不是待辦佇列裡的下一項**——標準化已收尾，
要不要做 D3 是獨立的決定。

補充 D3 的歸類理由：composer 已有 `border-top` 作為分隔，捲動陰影是在
既有分隔之上再加一層視覺提示，屬於精緻化而非缺失的行為，因此歸設計。

---

# Phase 5 — RWD 適配（規劃 v0）

2026-08-07。前提由使用者裁定：**agent service 也服務手機使用者，最低標
是「在手機上能完整聊天」**。此前本專案從未有過 RWD 規劃——不是規劃了
沒做，是規範與實作兩邊都不存在：UI-SPEC 全檔（Phase 1–4）沒出現過
斷點、`packages/ui/src/styles.css` 1933 行的 `@media` 只有
`prefers-color-scheme` 與 `prefers-reduced-motion` 兩種，寬度斷點是零。
唯一的響應式規則在 playground 的 `globals.css:64/160`，那是 demo 站的
自救，套用本 kit 的宿主拿不到。

歸類：依 476 行「標準化 vs 新功能」的判準，RWD **兩邊都不是**。既有
行為不是「有但沒規範」，而是「規則本身不存在」；也不是「需要先決定
該不該存在的新功能」，因為使用者已經裁定它該存在。所以另起 Phase 5，
不接在任何一條佇列後面。

## 5.0 範圍分層

不是所有東西都要上手機。分三層，並且**只有 P0 是承諾**：

| 層 | 內容 | 標準 |
|----|------|------|
| **P0** | thread 讀訊息、composer 打字送出、停止、附件、模型選擇 | 360px 寬完整可用，無橫向捲動 |
| **P1** | 20 種卡片在窄螢幕可讀 | 不爆版；資料密集型（table/comparison/code/diff）允許**卡片內**橫捲 |
| **P2** | playground dev 面板 | 能看即可，維持現有 900/980 隱藏側欄的做法 |

P2 刻意不投資：那是給開發者評估框架用的桌機工具，不是產品。把它做成
手機版會排擠 P0 的預算，而它的使用者本來就坐在電腦前。

## 5.1 策略：斷點制

### 5.1.1 container query 還是 media query

這是本章最重要的決策，因為選錯會讓整套規範答錯題。

`@super-solution/super-chat-ui` 是**嵌入式套件**，宿主可能把 `<Thread>` 放進 1920px
視窗裡的一個 380px 側欄。此時 media query 回報「桌機」，但元件實際
只有 380px——它會用寬版規則把自己撐爆。container query 問的是「我有
多寬」，那才是元件真正需要知道的事。

但 container query 不能取代 media query：觸控目標大小、iOS 的輸入框
縮放、safe-area、有沒有 hover，這些是**裝置屬性**，跟容器寬度無關。
一個 380px 的桌機側欄不需要 44px 觸控目標，一個全螢幕的手機需要。

**判準（規範）**：

| 問題屬於 | 用 | 錨點 |
|---------|-----|------|
| 「我有多寬」——版面、欄數、塌行、內距 | container query | `.sc-thread`、`.sc-ai`、`.sc-card` |
| 「我在什麼裝置上」——觸控、字級縮放、safe-area、hover | media query | `pointer: coarse`、`hover: none`、`prefers-*` |

有一個例外，實作時才浮現：`position: fixed` 的元素，其 containing block
就是視窗本身——視窗**就是**它的容器。所以 `.sc-toasts` 這類浮層走 media
query 不是破例，是照同一條判準得到的答案。kit 裡目前僅此一處寬度 media
query，測試把它釘住。

任何一條新規則落筆前先過這張表。分不清的情況幾乎不存在；若真的出現，
預設走 container query，因為它的錯誤模式（在寬容器上多留白）比 media
query 的錯誤模式（在窄容器上爆版）便宜得多。

**還有一件 container query 的硬性質，會咬人**：元素永遠不是自己的查詢
容器，只是後代的。所以 `.sc-thread` 自己的 padding 量的是
`.sc-threadwrap`（因此那層也要宣告 container），而 `.sc-card` 自己的
padding 量的是它上面最近的容器。在 Thread 裡那是 `.sc-thread`，成立；
但**宿主若在 Thread 之外渲染卡片，必須自己在外層宣告
`container-type: inline-size`**，否則卡片再窄都會維持桌機內距。卡片
內部（`.sc-funnel__row`、`.sc-media`…）不受影響，那些查的是卡片本身。
這條 kit 無法代替宿主處理，只能寫進規範並在 styles.css 註明。

### 5.1.2 斷點值：兩個，不是五個

```
compact : 600px   手機直立、窄側欄嵌入
medium  : 900px   平板直立、分割視窗
```

理由：斷點的成本不在寫，在驗。每多一個斷點，每個元件就多一組要在
瀏覽器上看過的組合。而 thread + composer 的版面只有兩種真正不同的
形態——單欄緊湊、單欄寬鬆。第三個斷點會是為了對稱而存在，不是為了
解決版面問題。

沿用 4.1 的角色化命名（`compact` / `medium`），不用 `--sc-bp-600`：
密度調整可以改動底下的 px 而不讓名字說謊。

### 5.1.3 一個必須寫進規範的硬限制

**CSS 自訂屬性不能用在 media / container query 的條件裡。**
`@container (max-width: var(--sc-bp-compact))` 不合法，不會報錯，
會靜默失效。這條不寫下來就一定有人踩。

所以斷點值只能是字面量。token 的角色降級為**文件性宣告**——寫在
`styles.css` 頂端的常數區塊，供人閱讀與 grep，不供 CSS 求值：

```css
/* 斷點常數（規範，非 CSS 變數——查詢條件不接受 var()）
   compact: 600px  |  medium: 900px
   全檔只准出現這兩個字面量；新增第三個值須先改本章。 */
```

「只准出現這兩個值」是可機器驗證的，見 5.4 第 1 層。規範能被測試
執行，才不會退化成註解。

### 5.1.4 覆寫方向：desktop-first 的寫法，mobile-first 的思維

現況 1933 行全是桌機預設值。翻成 mobile-first 等於全檔重寫，風險
遠大於收益。所以用 `max-width` 往下覆寫。

但**思維必須是 mobile-first**：每條覆寫要能單獨讀成「窄螢幕的規則
是什麼」，而不是「桌機規則在這裡有個例外」。落地做法是所有 compact
規則集中在檔案末尾的一個區塊、依元件分組，不散在各元件定義旁邊。
散著寫的結果是三個月後沒人答得出「手機上到底長怎樣」。

## 5.2 版面規則（container query）

`compact`（容器 ≤ 600px）的覆寫。未列出者維持桌機值——`auto-fit
minmax()` 的那幾個（`.sc-stats`、`.sc-media`）本來就自己會塌，不動。

| 元件 | 現況 | compact | 理由 |
|------|------|---------|------|
| `.sc-thread` padding | 20 | 12 | 左右各省 8px，在 360px 上是 4.5% 的內容寬度 |
| `.sc-bubble` max-width | `min(76%, 620px)` | `88%` | 76% 於 360px 只剩 274px，一行放不到 13 個中文字 |
| `.sc-msg` margin-bottom | 24 | 16 | 手機一屏訊息數比留白重要 |
| `.sc-ai__bar` | 單行 flex | 維持單行 | 塌成兩行會吃掉一整列輸入區高度，不划算 |
| `.sc-ai__model` 模型名 | 完整 | `max-width: 6em` + ellipsis | 「Claude Opus 4.5」會把 bar 撐破 |
| `.sc-ai__enhance` | icon + 文字 | 只留 icon | 省 ~50px，且 `aria-label` 已有 |
| `.sc-ai__menu` | `left: 0` + min-width 190 | 貼齊 composer 兩側 | 固定寬在 360px 上會溢出 |
| `.sc-ai__submenu` | `left: calc(100% + 4px)` 側開 | `position: static`，成為父選單內的縮排群組 | 190+170=360px，側開必定出界 |
| `.sc-media` | `minmax(160px, 1fr)` | `minmax(120px, 1fr)` | 讓 360px 仍能並排兩張 |
| `.sc-funnel__row` | `minmax(90,150) 1fr 48px` | `minmax(64,90) 1fr 40px` | 標籤欄讓位給資料條 |
| `.sc-code` gutter | 32px | 26px | 行號兩位數夠用 |
| `.sc-think__body` max-height | 260 | 200 | 展開後不該吃掉整屏 |
| `.sc-toasts` | `left:50% translateX(-50%)` | `left:12 right:12`、不位移 | 定寬置中在窄螢幕會貼邊 |

資料密集型卡片（`table`、`comparison`、`code`、`diff`）維持
`overflow-x: auto` 的**卡片內橫捲**，不塌成直式。把表格轉成
key-value 堆疊會失去對照能力，而對照正是這幾種卡片存在的理由。
規範是：**允許卡片內橫捲，禁止頁面橫捲**——兩者在驗收上是不同的
斷言（見 5.4）。

## 5.3 裝置規則（media query）

### 5.3.1 觸控目標

`@media (pointer: coarse)`：所有可點元素命中區 ≥ 44×44。

做法是**擴大命中區，不是放大按鈕**——`.sc-ai__icon` 撐成 44px 會讓
composer bar 整條變胖，破壞 4.3 定的密度。用透明偽元素外擴：

```css
.sc-ai__icon::after {
  content: ""; position: absolute; inset: -8px;  /* 28 + 16 = 44 */
}
```

適用：`.sc-ai__icon`(28)、`.sc-ai__send`(30)、`.sc-ai__chip-x`(padding 2)、
`.sc-ai__pill-x`(padding 1)、`.sc-code__copy`、`.sc-think__head` 的 icon。
偽元素外擴需要祖先 `position: relative`，逐一補。

### 5.3.2 hover-only 是缺陷，不是降級

`styles.css:1353-1356` 的 `.sc-todo__head:hover` 會切換內容
（headlist/pie/headcheck 淡出、chevron 淡入）。觸控裝置沒有 hover，
這個切換要嘛永不觸發、要嘛在點擊後卡住不還原。

規範：**任何 hover 才出現的操作都必須有非 hover 的等價路徑。**
`@media (hover: none)` 下 chevron 常駐顯示。這條比照原則 5
（reduced-motion 是一等公民）的寫法——每加一個 hover 行為，同一個
PR 要寫它的 `hover: none` 退化。

### 5.3.3 iOS 輸入框縮放

Safari 對 font-size < 16px 的輸入元素會在 focus 時自動放大整頁，
**而且不會縮回**。這是手機上最刺眼的單一缺陷。

現況兩個 composer 都中招：`.sc-composer__input` 走
`--sc-fs-body`(15px)、`.sc-ai__editor` 硬編 14px。兩者一律 16px。

**規範修正（實作後）**：這條原本寫在 compact 寬度層，是分類錯誤。
第 2 層測試在 768px 平板抓到——過了 compact 門檻、仍然是觸控裝置、
仍然是 Safari、照樣縮放。按 5.1.1 自己的判準，iOS 縮放是裝置特性，
歸 `@media (pointer: coarse)`，與容器寬度無關。已改。

16px 不給 token：它不是設計尺寸，是 Safari 停止縮放的門檻值，
命名會暗示它可以調。

### 5.3.4 視口與安全區

- 禁用 `100vh`，一律 `100dvh`。行動瀏覽器工具列會吃掉高度，`100vh`
  的底部永遠被切。現況 `globals.css:15/123` 兩處要遷移；全專案目前
  沒有任何 `dvh`。
- composer 底部 `padding-bottom: max(var(--sc-sp-12), env(safe-area-inset-bottom))`，
  避開 iPhone 的 home indicator。
- Next.js App Router 需在 `layout.tsx` 補 `export const viewport`，
  含 `interactiveWidget: "resizes-content"`——虛擬鍵盤彈出時讓版面
  重排而非蓋住 sticky composer。零 JS，優先於 VisualViewport API。

### 5.3.5 順帶償還的技術債

`styles.css` 有 22 處硬編 `font-size`，集中在 agent surfaces
（785 行以後）。那批元件是在 D1 的 token 遷移**之後**才加的
（commit 73ebca1），漏了遷移。其中 `11.5px`、`12.5px` 連 2.0.3 的
字級表都不在——是憑手感加的值。

標「遷移」，**與 Phase 5 一起做**，理由是 RWD 本來就要動這些值；
分兩次改同一行是白工。遷移規則沿用 2.0.3：11.5→11(`--sc-fs-micro`)、
12.5→12(`--sc-fs-meta`)、14→15(`--sc-fs-body`，composer 屬本文)。

## 5.4 美學：窄螢幕不是桌機的縮小版

核心立場：**縮的是 chrome，不是內容。**

手機的閱讀距離比桌機近，但螢幕小。若連本文字級一起縮，就是雙重
懲罰。所以 4.3「對話優先」的密度原則在窄螢幕**更強**，不是更弱：

- 訊息本文 `--sc-fs-body` **不縮**（15px），composer 反而升到 16px。
- 縮的是 padding、gap、meta 行、內距——那些是框，不是話。

其餘四條：

**卡片不要通欄貼邊。** compact 下仍保留左右各 12px 呼吸。卡片一旦
貼齊螢幕兩側就不再讀作「訊息裡的物件」，而是「一段全寬區塊」，
B 章建立的卡片識別度會消失。省下的 24px 不值這個代價。

**border-first flat 在窄螢幕更划算。** 原則 2 維持不變。沒有陰影
就沒有「浮起來的東西擋住內容」，而手機上被擋住的成本遠高於桌機。

**accent 節制（4.4）維持。** 空間變小不是用顏色分區的理由——小螢幕
上高彩度色塊的密度感知比桌機強，放寬只會更花。

**空狀態要改，這是只有想過手機才會發現的問題。** R1 定的「大字問候
置中 + composer 置中」在手機上會壞：鍵盤一彈出吃掉近半螢幕，置中的
問候被擠出視野，使用者看到的是一片空白加一個輸入框。compact 下改
**上緣對齊**。R1 的意圖（composer 是主角）不變，置中只是它在桌機上的
實作方式。字級不動——草案原本寫「問候降一級字」，那與本節開頭
「縮 chrome 不縮內容」自相矛盾，且 `.sc-empty` 自己的註解已寫明它是
閱讀尺寸而非 UI 尺寸。以原則為準，改掉草案。

**動效：composer 不做進出場動畫。** `--sc-dur-*` 全部沿用，但手機上
鍵盤本身已經在動，再疊一層 composer 的位移會暈。

## 5.5 測試策略

現況要先講清楚：vitest `environment: "node"`，20+ 測試檔全是純邏輯，
**沒有任何 DOM 測試能力**——沒有 jsdom、沒有 testing-library、沒有
Playwright。過去 Phase 3/4 的「瀏覽器實測」是人工目視。

也要先排除一條死路：**jsdom 對 RWD 無用**。它沒有排版引擎，
`getBoundingClientRect()` 一律回傳 0，量不到寬度、測不出溢出。加了
它只會製造「有測試」的錯覺。真正能驗版面的只有真瀏覽器。

### 第 1 層：CSS 靜態約束（零新依賴，最划算，每批必過）

用現有 vitest 讀 `styles.css` 字串做斷言。專案已有先例——
`registry-sync.test.ts` 就是讀原始碼做一致性斷言，風格一致。

| 斷言 | 擋掉的錯誤 |
|------|-----------|
| 查詢條件只出現 `600px` / `900px` | 有人隨手加 `768px` |
| 全檔無 `100vh` | 行動瀏覽器底部被切 |
| compact 區塊內 `.sc-ai__editor`、`.sc-composer__input` 的 font-size ≥ 16px | iOS focus 縮放回歸 |
| 查詢條件不含 `var(` | 踩 5.1.3 的靜默失效 |
| 全檔無 raw hex（補既有原則 3） | token 制度被繞過 |

這層完全符合原則 1（零依賴），且執行速度以毫秒計，適合掛在每批的
完成定義上。

### 第 2 層：真瀏覽器版面測試（Playwright）

成本比預期低——環境已預裝 Chromium 且 `PLAYWRIGHT_BROWSERS_PATH`
已設好，不需下載瀏覽器。

三組視窗：`360×640`（小手機下限）、`390×844`（主流 iPhone）、
`768×1024`（平板直立），外加第四組 `1280×900`。

第四組不是 RWD 的一層，是**回歸防線**。上面每一條規則都是加進一份原本
在桌機寬度已經成立的樣式表，而「compact 值溢出到它不該生效的寬度」對
一個只看手機的測試套件是隱形的。它斷言桌機保住 thread padding 20、
composer 15px、側欄仍是側欄，以及**觸控命中區的偽元素不得出現**。

這一組也順手示範了一件事：它最初寫成「桌機視窗 ⇒ 桌機氣泡」而失敗——
`/run` 在 1280px 下讓掉 232px 側欄與 330px 事件欄，thread 實際只有
678px，medium 層在那裡本來就是對的。用視窗寬度推論版面，正是這整套
設計否定的思維，連寫測試的人都會不小心犯。氣泡層級的斷言因此改成
**由實測容器寬度推算應套用哪一層**，四組視窗共用同一條規則。

| 測項 | 斷言 |
|------|------|
| 無頁面橫捲 | `documentElement.scrollWidth <= innerWidth`——一條就能抓掉九成爆版 |
| 卡片內橫捲仍允許 | 對 `.sc-table-wrap` 等白名單容器豁免上一條 |
| **能聊天（P0 驗收）** | 輸入 → 送出 → 訊息出現在 thread；這就是使用者裁定的最低標 |
| 觸控目標 | 逐一量 `boundingBox()`，斷言 ≥ 44 |
| 選單不出界 | 開啟附件選單與子選單，斷言 rect 在視窗內 |

**依賴放在 root 的 devDependencies，不進 `packages/ui`。** 原則 1
講的是套件的 runtime 依賴——「drops into any app without imposing a
build step」——測試工具不會被宿主安裝。這個區分要寫明，否則會被
誤讀成違反零依賴。

### 第 3 層：真機人工驗收

前兩層跑在 Chromium 上（本環境唯一可用的引擎），而這一層存在的理由
就是那件事：**引擎不同、行為不同的部分，自動化證明不了**。刻意不用
`devices["iPhone 14"]` 這類描述檔——它們帶 `defaultBrowserType:
"webkit"`，會去啟動一個不存在的瀏覽器；真正驅動 `pointer: coarse` 與
`hover: none` 的是 `isMobile` + `hasTouch`，Chromium 都支援。

| # | 項目 | 裝置 | 通過條件 |
|---|------|------|---------|
| 1 | 點入 composer | iOS Safari | 頁面不放大；放開後不需手動縮回 |
| 2 | 鍵盤彈出 | iOS Safari | composer 浮在鍵盤上緣，不被蓋住、不被推出畫面 |
| 3 | 鍵盤彈出時捲動 thread | iOS Safari | composer 維持貼底，不隨內容漂移 |
| 4 | 底部留白 | iPhone（有 home indicator） | 送出鈕不與 indicator 重疊 |
| 5 | 上下捲動 | iOS Safari | 動態工具列收合時版面不跳動（`100dvh` 的實測） |
| 6 | 鍵盤彈出 | Android Chrome | `interactiveWidget: resizes-content` 生效，版面縮而非被蓋 |
| 7 | 點附件選單 → 技能子選單 | 任一觸控機 | 子選單在父選單內縮排展開，不出界 |
| 8 | 點 to-do 標頭兩次 | 任一觸控機 | 進度圓餅不消失、不卡在 chevron 狀態 |
| 9 | 連點 composer 上各控制項 | 任一觸控機 | 不誤觸鄰鍵（44px 命中區的實測） |
| 10 | 橫置 | 任一手機 | 無橫向捲動，composer 仍貼底 |

第 1、2、5、6 項是這層真正無可取代的部分；其餘在第 2 層已有自動斷言，
列在這裡是因為真手指與合成事件的差別本身值得看一次。

### 完成定義

每一批要過**第 1 層 + 第 2 層**才算 ✅，第 3 層在 M3 一次驗收。
這比照 Phase 3/4 的「✅ 完成並瀏覽器驗證」標準，並把「瀏覽器驗證」
從人工目視升級成可重跑的斷言。

## 5.6 實施批次

編號用 **M**（Mobile）。Phase 3 用 1–4、Phase 4 用 D1–D3、
`R1–R5` 已被 2.A 的競品觀察佔用。另起字首是為了不讓任何人把這條
佇列讀成前面某一條的續集——理由同 4.8。

| 批次 | 內容 | 狀態 |
|------|------|------|
| **M1** | 地基與缺陷：斷點常數區塊、`100dvh` 遷移、safe-area、viewport export、iOS 16px、硬編 px 遷移（5.3.5）、觸控命中區、`hover: none` 退化（todo bug）、第 1 層測試 | ✅ 完成，12 項第 1 層斷言 |
| **M2** | P0 版面：thread/bubble/msg 的 compact 值、composer bar 塌行規則、選單貼邊與 submenu 攤平、空狀態上緣對齊、第 2 層測試 | ✅ 完成並瀏覽器驗證 |
| **M3** | P1 卡片逐一過窄螢幕 + P2 playground 面板 + 第 3 層真機清單 | ✅ 自動化部分完成；第 3 層清單待真機執行 |

M1 全是「壞了要修」，與版面決策無關，可獨立驗收——所以排第一，
不是因為它簡單，是因為它不依賴任何尚未定案的東西。M2 才是使用者
要的「至少能聊天」。M3 是把 P1/P2 收乾淨。

**M2 落筆前的未定案，已解決，而且比兩個候選方案都好**：原本在
「改 drill-in（要動 `AgentInput.tsx` 狀態）」與「compact 下攤平成單層」
之間二選一。實際做法是第三條路——compact 下把 `.sc-ai__submenu` 改成
`position: static`，它就地變成父選單裡的一個縮排群組，選單往下長而不是
往旁邊長。**DOM 與 state 完全不動**，資訊也沒少，純 CSS。原本評估
「動元件邏輯」是必要成本，那個前提是錯的。

## 5.7 實作後的修正紀錄

規劃與實作不一致的地方，一律以實作為準並在上面各節就地改掉。這裡只記
**改了什麼、為什麼**，因為每一條都是規劃當下看不出來、要跑過才知道的。

| # | 規劃 | 實際 | 原因 |
|---|------|------|------|
| 1 | iOS 16px 放 compact 寬度層 | 移到 `@media (pointer: coarse)` | 768px 平板過了 compact 門檻仍會縮放。按 5.1.1 自己的判準本來就該歸裝置層，是分類錯誤 |
| 2 | submenu 改 drill-in 或攤平 | `position: static` 變父選單內縮排群組 | 兩個候選都預設「要動元件狀態」，前提是錯的 |
| 3 | 卡片 compact padding 自動成立 | 宿主須在 Thread 外自行宣告 container | 元素不是自己的容器；卡片內部沒事，卡片自己的 padding 需要祖先 |
| 4 | 空狀態問候降一級字 | 字級不動 | 與同節「縮 chrome 不縮內容」矛盾 |
| 5 | 900px 以下隱藏 dev 側欄（沿用現況） | 改成頂部橫向捲動 tab 條 | 隱藏等於手機上完全無法切換面板。P2 是「不投資」，不是「可以壞」 |
| 6 | — | playground 的 980px 併入 900px | 兩斷點規範只管了 kit，app 自己飄出第三個值。測試已擴及 app |
| 7 | — | `.dev__run` 由 `100dvh` 改 `100%` | nav 變頂部條之後，視窗高度不再等於面板高度 |

第 1 與第 3 項是第 2 層測試抓出來的，不是讀 CSS 讀出來的——這正是
5.5 主張「真瀏覽器不可省」的具體證據。第 5 項是寫測試時順手發現的：
自動化斷言「面板不爆版」會通過，但「使用者到得了那個面板嗎」要人問。

### 順帶償還的既有債

不屬於 RWD，但改在同一批，因為動到同一批行：

- 23 處硬編 `font-size` 遷移為 token（5.3.5），含兩個不在 2.0.3 字級表上
  的 `11.5px` / `12.5px`。
- 三處選單陰影各自重寫了 `--sc-shadow-overlay` 已定義的值，改用 token。
  順帶修好暗色模式——原本 14% 黑在暗底上根本讀不出層次。
- `.sc-btn--danger` 硬編 `#fff`。新增 `--sc-negative-contrast`，比照
  `--sc-accent-contrast` 一起翻轉：暗色模式的 negative 是淺紅，白字在
  上面是不可讀的那個選項。
- 唯一保留的字面量 `font-size`：`.sc-chart__label`，它畫在 SVG user
  space，那個數字是座標不是字級（比照 2.0.2 對 SVG 的豁免）。測試知道
  這一行。

### 現在跑得起來的東西

```
pnpm test        # 276 unit，含 13 項第 1 層 RWD 斷言
pnpm test:rwd    # 64 項第 2 層，360 / 390 / 768 / 1280 四組視窗
pnpm typecheck
```

第 2 層對 dev server 與 `next build` 的 production 產出都跑過，結果一致。

第 2 層需要 Chromium。本環境已預裝但版本與 Playwright 預期的 build 不
同，所以 `playwright.config.ts` 用 `executablePath` 指過去；設
`PLAYWRIGHT_CHROMIUM_PATH` 可覆寫，不設則回到 Playwright 自己管理的
下載，也就是一般 CI 的行為。

---

# Phase 6 — 文件 artifact（規劃 v0）

2026-08-10。前提由使用者裁定三件事，其餘從它們推導：

1. **文件是對話中生成的 artifact**，不是上傳的檔案。沒有匯入路徑。
2. **格式是 Markdown**，並且預設以 previewer 呈現而非行內文字。
3. **在 previewer 裡選取的內容，要能成為下一個 request 的 context**。
4. 文件的存放與執行走 **host-run**：框架定義協定與核准介面，宿主擁有儲存。

編號另起 **N**（Notebook／文件），理由同 4.8 與 5.6——`1–4` 是 Phase 3、
`D1–D3` 是 Phase 4、`R1–R5` 是 2.A 的競品觀察、`M1–M3` 是 Phase 5。

## 6.0 為什麼這是第六個接縫

專案已有五個狀態接縫，文件一個都不屬於：

| 既有 | 為什麼裝不下文件 |
|------|-----------------|
| `ThreadStore` | 文件壽命長於 thread，且不該被 compaction 修剪 |
| `FileStore` | 存的是**不可變**的 provider ref；文件每改一次舊 ref 就作廢 |
| `MemoryStore` | 沒有位置概念，無法定址 |
| `Retriever` | 唯讀 |
| `app-state` | 自己寫明「no diffing, no CRDT, no bidirectional sync」 |

最後一條要特別處理。`app-state.ts` 的那句非目標**對 UI 狀態完全正確**——
UI 有自己的 render loop，替它做 diff 是在跟宿主的狀態管理搶工作。但對文件
而言 **diff 就是產品本身**：使用者要看到改了哪裡才能核准。

所以這不是推翻那條規則，是**它的適用範圍不含文件**。兩者分屬不同模組，
理由寫在這裡，以免日後有人把它們合併成一個「通用狀態接縫」。

## 6.1 範圍分層

| 層 | 內容 | 標準 |
|----|------|------|
| **P0** | 生成文件 → previewer 呈現 → 選取一段 → 針對它問下一題 | 不需要任何編輯功能就成立 |
| **P1** | 改文件：錨定編輯、diff 核准、版本與 undo | 改動必須可審、可退 |
| **P2** | 對外產物：compose card、mailto、`.eml` | 不持有任何憑證 |

**P0 自成一個可交付的東西**，這點值得單獨講：模型產出文件、使用者讀、
圈一段追問——這個迴圈在完全沒有編輯功能時就有價值，而且它不依賴任何
尚未定案的協定。所以它排第一，不是因為簡單。

## 6.2 錨點：區塊級原始碼位移

### 6.2.1 為什麼現有 renderer 擋路

`packages/ui/src/markdown.ts` 是一條**正則鏈，不是解析器**：先全文 escape、
再把 fence 抽成 placeholder、再一路 replace。跑完之後**原始碼位置已被
銷毀**，所以「使用者在預覽區選的這段，對應原始 Markdown 的哪裡」無法回答。

而這個答案是兩個功能共用的：選取要當 context 需要它，編輯要落在正確位置
也需要它。**同一個機制服務兩件事**，所以它是地基，不是附加需求。

### 6.2.2 三個方案與取捨

| 方案 | 判決 |
|------|------|
| 換 markdown 套件 | 出局。違反原則 1（`packages/ui` 零依賴） |
| 只用選取到的**渲染後文字**回頭搜原始碼 | 出局。`**粗體**` 渲染成 `粗體`，選取範圍一跨到行內標記就搜不到 |
| **區塊級位移**（採用） | 粗定位由 DOM 給，精定位在該區塊的原始碼裡做唯一性比對 |

區塊級的好處是它**不需要行內解析**——現有那條正則鏈原封不動繼續用——
而且它產出的錨點形狀跟編輯協定要的錨點是同一個。

### 6.2.3 一個會咬人的實作順序

現行 escape 是**先做**的，而 `&` → `&amp;` 會改變字串長度。要保住位移，
**escape 必須移到每個區塊內部、在位置記錄之後**。這是重構這支檔案時最
容易錯的一步，也是最不容易在瀏覽器上看出來的一步——版面完全正常，只有
錨點默默偏移。測試要盯住它。

### 6.2.4 API 形狀

```
renderMarkdown(src): string                    // 不變，不帶 data 屬性
renderMarkdownWithAnchors(src): { html, blocks } // 區塊元素帶 data-sc-block
```

保留兩支而不是加參數，因為對話裡的助理文字**不需要錨點**，多輸出一組
屬性只是雜訊。既有 7 個測試斷言的是不帶屬性的輸出，也因此不用改。

## 6.3 引用屬於使用者訊息，不屬於 app-state

直覺會說「selection 是螢幕狀態，做成 app-state binding」。**那是錯的**，
而且錯得很貴：

- app-state 是「使用者現在正在看什麼」，每回合重讀。引用則是**釘在某一個
  request** 上；下一回合使用者沒再選，它就不該還在。
- 它會**過期**。使用者選 A、送出、再選 B——若走 app-state，第一則訊息在
  歷史裡回看時會顯示 B。
- 它**不可以被預算裁掉**。app-state 被裁只是少了環境資訊；使用者親手圈的
  段落被裁掉，是把使用者說的話弄丟了，那是正確性錯誤，不是預算最佳化。

**規範**：引用攤平成使用者訊息的 `text` part（送給模型），結構化形式放
`Message.metadata`——該欄位的註解已寫明「Free-form host metadata.
**Never sent to a provider**」。provider 那側零改動，歷史回看時 chip
還原得回來。

UI 用既有的 `.sc-ai__pill`（技能 pill：與文字同行、整塊刪除），不新做。

## 6.4 Previewer 的邊界

HANDOFF 把「any kind of visual builder」列為刻意不做，而這裡很接近那條線。
判準：

> **Previewer 做渲染、選取、看 diff。不做編輯 chrome。**
> 沒有工具列、沒有所見即所得、沒有游標。修改一律走對話 + diff 核准。

這樣它是元件，不是編輯器。一旦出現「在預覽區直接打字」的需求，那是宿主
自己的產品決定，框架給的是 Markdown 與錨點，不是編輯器。

文件卡片做成一個 `document` card kind，免費繼承四件事：

1. **`stripCardPayload`**——文件本體不會每回合重複計費。模型要看內容就用
   `readDocument` 去讀。這個分工不用發明，它已經是既有規則。
2. `updateCard` + `ToolResultExtras.cardId`——改完原地更新同一張卡，對話裡
   不會長出十張文件。
3. `registry-sync.test.ts` 強制 validator 與 renderer 成對。
4. `export.ts` 已經會把卡片序列化成 Markdown。

## 6.5 編輯協定（P1）

### 6.5.1 定址：錨定 search/replace

模型**不得回傳整份文件**。整份重寫會同時帶來三個問題：token 成本正比於
「文件大小 × 修改次數」、模型會順手改掉沒要它改的段落、以及**整份都變了
就沒有可審的 diff**。

編輯是「針對錨點的操作」：`{ blockRange, find, replace }`。比對不到唯一
位置時回 `failure: "invalid-input"`（既有的 kind），讓模型重讀重試，而
不是讓使用者收到一個改錯地方的文件。這與 `tools/repair.ts` 處理壞掉的
工具參數是同一類問題，處理方式應一致。

### 6.5.2 讀取：大綱優先

編輯是**有方向的活動**（「看第四節」），不是相似度搜尋。所以
`readDocument(docId, { outline | span | search })`，且**先給大綱**——標題 +
區塊 id + 各段長度，很便宜，但讓模型能有意識地導航而不是碰運氣。

### 6.5.3 核准：diff card 要變成互動的

`diffCard` 目前沒有 `interactive: true`，但在 in-chat 編輯裡 **diff 就是
核准介面**。要逐 hunk 接受／拒絕。

這幾乎不用新機制：`side: "confirm"` + `requestCard` 已能中止 run 等使用者、
`updateCard` 已能原地更新。缺的只是那張卡本身。

### 6.5.4 樂觀並行

使用者可能在宿主那側改了文件、而 run 還在飛，錨點就過期了。每次寫入帶
`revision`，過期就失敗讓模型重讀。**便宜，但事後補不回來**——第一版就要
進協定。

### 6.5.5 Undo 是版本，不是反向操作

每次套用鑄一個版本，undo = 切回上一版。因為版本本來就要存，這幾乎免費，
而且不會有「反向操作算錯」這個類別的 bug。

**不要串流套用編輯。** 串流「思考」可以；套用必須是原子的。半套用的文件
比慢的文件糟糕得多。

## 6.6 對外產物（P2）

`mailto:` 命中 `draft` 這個 preset 層級——「produces something the USER
must approve/sign. No side effects.」——零憑證、零送信權限。

但它的限制是硬的，規劃時就要寫下來：

- 實務 URL 長度上限約 2000 字元，**超過會靜默截斷**
- **完全不支援附件**
- 內文只有純文字，沒有 HTML
- 換行編碼（`%0D%0A`）各家客戶端不一致
- 桌機上沒設定預設信件軟體時，**什麼都不會發生，也沒有錯誤**

所以形狀不是「做一個 mailto 工具」，而是 **`composeEmail` 一律產生一張
可編輯的 compose card**，卡片上三條出口：開啟信件軟體（mailto）、複製、
**下載 `.eml`**。另留一個宿主可插入的 `send` 槽位，沒插就不顯示送出鈕。

`.eml` 被嚴重低估：一次解決附件與 HTML、離線可用、每個信件軟體都打得開。
它比一個被截斷的 mailto 好得多，所以**它是主要出口，mailto 是便利捷徑**。

框架不持有信件憑證，理由同 Transport 的「adapter 從不持有憑證」。

## 6.7 美學與 RWD 承接

Phase 5 剛立的規範對這個新表面全部適用，有兩件要在第一版就決定：

**側邊 previewer 在 compact 層不存在。** 形狀是：**行內卡片為預設、可展開
成面板；compact 下面板變成全螢幕 sheet**。事後改等於重做。

**iOS 原生選取 UI 會跟自訂的「引用」按鈕打架。** 系統的放大鏡與 callout
bar 會蓋住浮動按鈕，`selectionchange` 的時序也與桌機不同。這是那種在桌機
上覺得很順、拿到手機上不能用的功能。**手機上的引用可能需要不同的觸發
方式**（長按選取後在 composer 上方浮出 chip，而不是在選取處浮按鈕），
列入第 3 層真機清單。

其餘沿用 4.x：文件本文走 `--sc-fs-body` 不縮、border-first、accent 節制。

## 6.8 測試策略

沿用 5.5 的三層，各層負責的東西不同：

**第 1 層（vitest，無新依賴）**——錨點的正確性是純函數，這裡能測完：
- 每個區塊的 `[start, end)` 切回原始碼要等於該區塊的原文
- escape 之後位移不得偏移（6.2.3 那個陷阱的專屬回歸測試）
- fence 內含空行時仍是**單一**區塊
- 引用攤平後模型看得到內容、`metadata` 不進 provider payload
- `document` card 的 validator／renderer 成對（既有 registry-sync 自動涵蓋）

**第 2 層（Playwright）**——選取是 DOM 行為，只有真瀏覽器能測：
- 在 previewer 選取一段 → composer 出現 chip → 送出 → 該段出現在請求裡
- 選取跨區塊時錨點涵蓋正確的區塊範圍
- compact 下展開成 sheet、無橫向捲動（沿用 5.5 的斷言）

**第 3 層（真機）**——iOS 選取 UI 衝突，見 6.7。

## 6.9 實施批次

| 批次 | 內容 | 狀態 |
|------|------|------|
| **N1** | `markdown.ts` 保留區塊位移 + `renderMarkdownWithAnchors`；escape 移進區塊內 | ✅ 完成，8 項第 1 層斷言 |
| **N2** | `document` card kind + `DocumentCardView` previewer（渲染／展開／compact sheet） | ✅ 完成並瀏覽器驗證 |
| **N3** | 選取 → composer chip → user message 的 text part + metadata | ✅ 完成並瀏覽器驗證 |
| **N4** | 文件協定：`DocumentStore`（宿主擁有）、`createDocument` / `readDocument`、錨定編輯、`revision` | ✅ 完成，29 項第 1 層斷言 |
| **N5** | 互動式 diff card：逐 hunk 接受、`confirm`、版本與 undo | ✅ 完成並瀏覽器驗證 |
| **N6** | compose card + mailto + `.eml` + 宿主 send 槽位 | ✅ 完成並瀏覽器驗證 |

N1–N3 合起來就是 P0，**在完全沒有編輯功能時已可交付**。N6 只依賴 N4 的
文件模型，可與 N5 並行。


## 6.10 N1–N3 實作紀錄

P0 已可交付：模型產文件 → previewer 呈現 → 圈一段 → 追問。編輯功能一行都
還沒寫。

### 一個只有瀏覽器抓得到的錯

**症狀**：選取解析完全正確，但引用列一出現就消失。**原因不在選取程式碼**
——每次 render 都傳一個新的 `{ __html }` 物件給 `dangerouslySetInnerHTML`，
React 就重新套用 `innerHTML`，即使字串一模一樣。重套 `innerHTML` 會摧毀
並重建所有子節點，而選取活在那些節點裡，於是**顯示引用列這個動作本身，
毀掉了引用列要顯示的那個選取**。

這件事讀 CSS、讀型別、跑單元測試都看不到；`Range` 解析出來的值是對的，
測試也會過。只有真瀏覽器裡的「選了 → 出現 → 不見了」能暴露它。
`tests/document.spec.ts` 現在有一條專門釘住它的回歸測試。

**順帶修正一個互動設計**：原本設計是「選取變空就收回引用列」。這在
任何情況下都行不通——**伸手去按按鈕的動作本身就會清掉選取**，觸控上更是
在 click 送達之前就發生。所以改成：引用列只被新的選取取代，永不因空選取
自行消失，要收回請按 ✕。這不是繞過 bug，是原本就該這樣。

### 其餘與規劃一致

| 6.2.3 預告的陷阱 | escape 移到區塊內部之後位移才對齊。已有專屬回歸測試 |
| 6.3 的判斷 | 引用進 user message 的 text part + `metadata`；adapter 零改動 |
| 6.4 的邊界 | previewer 沒有工具列、沒有游標；`document` card 繼承 `stripCardPayload`，文件本體不重複計費 |
| 6.7 的形狀 | 行內卡片 → 展開面板 → compact 變 sheet，四組視窗都驗過無橫向溢出 |

### 一個規劃沒寫、實作補上的東西

`DocumentQuoteProvider`（quote bus）。少了它，宿主得自己把 previewer 的
`onQuote` 接到自己的 state、再餵回 composer ——而使用者眼中那只是一個
動作。那段接線正是這功能要消滅的摩擦，所以 kit 自己做掉。它放在
`packages/ui` 而不是 `packages/react`，因為兩端都是 UI 元件。

Provider 是選用的：沒掛就不提供引用功能，這對「只想渲染文件、不要 composer
整合」的宿主是正確的降級。

### 現在跑得起來的東西

```
pnpm test        # 309 unit（+8 錨點、+8 引用格式、+3 client 端到端）
pnpm test:rwd    # 96 項第 2 層，含 8 項文件測試 × 4 組視窗
pnpm typecheck
```

第 2 層若在自帶 Chromium 的沙箱裡跑，用 `PLAYWRIGHT_CHROMIUM_PATH` 指過去；
不設就走 Playwright 自己管理的下載，也就是一般環境的行為。

### 與 main 的整併

這批是在 Phase 5 合併之後、於較新的 main 上重新接枝的，有四處要留意：

- 套件已改名為 `@super-solution/super-chat-*`，本批所有新檔案跟著改。
- 規範文件已移入 `docs/`。
- main 為 `renderMarkdown` 加了「整份沒有 markdown 字元就跳過正則鏈」的
  快速路徑。改寫**保留該最佳化並改成逐區塊套用**——一份只有一個程式碼
  區塊的長文件，不該讓其餘四十段都失去這個捷徑。
- `BUILTIN_RENDERERS` 在 main 改用 `register()` 輔助函式；`document`
  依同一形式註冊，位置仍緊鄰 `markdown`。


## 6.11 N4–N6 實作紀錄

編輯迴圈完成：產文件 → 讀大綱 → 定點改 → 逐 hunk 核准 → 產出對外文件。

### 「拒絕」是這批最重要的程式碼

`applyEdits` 的一半篇幅在拒絕。找不到 → `not-found`（叫模型重讀）、找到
兩次 → `ambiguous`（叫它加長錨點或指定 block）。**兩者都不猜**。

這條規則的價值不在乾淨，在於失敗模式：第一個匹配優先會把改動放到沒人要
求的位置，然後把它**當成刻意的結果放進 diff 給使用者核准** —— 而 diff 讀
起來完全正常，使用者就按了同意。拒絕會被模型看到並重試；猜錯不會。

同理，編輯的位移全部對**原文**解析、由後往前套用，所以前一個編輯改變長度
不會挪動後一個。兩個編輯範圍重疊視為矛盾而非合併，也是拒絕。

### 三個「本來會很誘人」的簡化，都沒做

| 誘惑 | 為什麼不做 |
|------|-----------|
| 讓模型回傳整份文件 | 成本正比於「大小 × 次數」、會順手改沒要求的段落，而且**整份都變了就沒有可審的 diff** |
| 用文字 diff 算 hunk | 算出來的區塊**不能各自套用**，而「逐條接受」正是要問的問題。改成「一個編輯 = 一個 hunk」，因為編輯本身就自帶錨點 |
| undo 算反向編輯 | 反向編輯**會算錯**，而且正好在文件已經前進時算錯。改成存整份舊版、undo 是 checkout；而且 undo 鑄**新的** revision，讓針對舊版提出的 in-flight 編輯被拒而不是誤套 |

### 一個被測試糾正的分類

`email` 卡片最初標成 `interactive: true`，因為它有輸入框。錯了：這裡的
interactive 意思是「**run 會掛起等使用者回答**」。email 草稿沒有任何東西
在等它 —— 模型沒有提問，它產出了一個東西。標成 interactive 只會讓它跟真正
的決定排在同一條序列裡。`editreview` 才是真的：文件在答案回來前不會變。

`cards.test.ts` 那條「哪些 kind 是 interactive」的守門測試因此擋下了它，
現在那條測試也寫明了判準是「有東西在等」而不是「卡片上有控制項」。

### 對外產物：`.eml` 是主要出口

規劃寫「mailto 是便利捷徑」，實作把它落實成介面順序：**下載 `.eml` 是
primary 按鈕**，mailto 是次要連結，而且 body 一超過 2000 字元就在使用者
按下去**之前**警告 —— 那個失敗在每個信件軟體裡都是靜默的，信寄出去少了
結尾而沒有任何提示。

`.eml` 刻意不寫 `Date` 與 `Message-ID`：草稿還沒寄，蓋上寄送時間是個小
謊，而有些客戶端會把它當事實顯示。

沒有宿主提供 `onSend` 就**不顯示送出鈕**。框架不持有信件憑證，理由同
Transport 的「adapter 從不持有憑證」。

### 一個結構調整

`splitBlocks` 從 `packages/ui` 移到 `packages/core/src/content/blocks.ts`。
不是整理，是正確性：previewer 把 DOM 選取換算成 block 索引，編輯協定再把
同一個索引換算回可以改寫的文字 —— **兩份實作會漂移，而漂移是靜默的**：
引用指向 block 4、編輯落在 block 5，兩邊看起來都正常，直到有人讀結果。

### 現在跑得起來的東西

```
pnpm test        # 338 unit
pnpm test:rwd    # 120 項第 2 層，含 14 項文件測試 × 4 組視窗
pnpm typecheck
```

---

## 6.12 N7 實作紀錄：把「文件」真的當文件看

N1–N6 之後補的一批。起點是一個很小的觀察：規格從頭到尾說 document 是「使用者
會留下來、會回來看、會下載成 `.md` 的東西」，但 renderer 還是那個為聊天泡泡寫
的 renderer。這兩件事不相容，而且不相容的地方剛好都是靜默的。

### 一個 renderer 的假設，被原地升格成規範

`renderMarkdown` 原本支援 h1–h3、粗斜體、行內 code、連結、無序清單。對一則
訊息這個量剛好，註解也是這樣論證的，論證沒有錯 —— 錯在後來 document 沿用了
同一個 renderer，而沒有人重新問過那個量夠不夠。

**寫報告的人第一段就會用到表格。** 表格、引用、有序清單、縮排程式碼，在舊的
renderer 底下全部以字面輸出：一份帶表格的合約比較，在 previewer 裡是一排 `|`。
那不是一份文件，那是一份文件的原始碼。

結構也跟著換了。一串跑在整份已 escape 字串上的 global regex 沒有辦法分辨
表格和段落，所以現在每個 block 先**分類**再依形狀渲染，只有葉節點跑 inline
轉換。巢狀（引用裡的清單、清單裡的引用）是把 block 內部丟回同一個 splitter
得到的，附一個深度上限，讓病態的 `> > > > …` 不會無限遞迴。

順帶修掉一個一直都在的不對稱：fence 內容受保護、行內 code span 不受保護，
所以 `` `**x**` `` 會變粗體。沒有人選擇過這件事，它只是 regex 鏈的順序造成的。

### 錨點的定義本身有洞

這是這批最該記下來的一條，因為它正是 6.11 把 `splitBlocks` 搬進 core 想避免的
那個失效模式，只是換了一個入口進來。

搬進 core 解決的是「兩份實作漂移」。沒解決的是**那一份實作本身就切錯**：

```
isFence = text.startsWith("```")
```

- 一個 ```` 區塊裡包一個 ``` 區塊 —— 常見到不行，任何解釋 fence 的技術文件都會
  有 —— 會在內層收掉，一個區塊碎成四塊，中間那段程式碼變成 prose。
- `~~~` 根本不算 fence，於是文件裡下一個 ``` 開了一個永遠不會關的區塊，把後面
  整份吞掉。

兩種情況的後果一樣：**該點之後每一個錨點都指向錯的文字，而畫面看起來完全正常**。
引用指向 block 4、編輯落在 block 5，兩邊都合理，直到有人讀結果 —— 一字不差就是
6.11 寫下的那句話。fence 現在比對字元與長度；鬆散清單（項目之間有空行）與跨空行
的引用也不再被切成好幾塊，因為切開之後 previewer 會渲染出三個 `<ul>`，大綱也會
報三筆使用者眼中只有一個的東西。

### 一個接縫少了入口

規格第一句話是「文件的壽命長過 thread」。這句話對 store 成立，對 agent 不成立：
`docId` 只在 tool result 裡出現過一次，而 tool result 活在 transcript 裡 ——
compaction 會修掉它，新 thread 從來沒有過它。文件活下來了，模型叫不出它的名字。

`listDocuments` 補的是這個。只回標題與大小、不回內容，所以一份文件一行。

### 兩個「規格沒寫、但拒絕它比較誠實」的實作細節

- **排序的 tie-break。** `updatedAt` 是毫秒，同一個 tick 建立的兩份文件會打平，
  而打平之後穩定排序給的是插入順序 —— 也就是最舊的在最前面，正好相反。
- **`.eml` 的行長。** RFC 5322 的 998 octets 是 MUST，不是建議；嚴格的 parser
  可以直接拒收。一段沒有換行的長段落就會超過，而「一段沒有換行的長段落」正是
  模型預設寫出來的東西。這裡沒有選擇折行 —— 折 prose 等於在使用者即將寄出的信裡
  塞進他沒有寫的斷行 —— 而是切到 quoted-printable，用軟斷行無損地帶過去。
  RFC 2047 encoded-word 的 75 字上限同理，切點必須落在 UTF-8 字元邊界上，
  否則主旨中間會出現一個看起來像寄件人手誤的替代字元。

### 一個面板

`/documents`。九個能力九個面板，documents 是最大的一塊而先前只掛在 `/run` 裡。

它不接模型，這是刻意的：**編輯協定最重要的一半是拒絕，而腳本化的 demo transport
永遠不會觸發拒絕**。面板上六個按鈕，三個會過、三個會被拒，開發者可以自己把
`not-found` / `ambiguous` / `no-such-block` 一個一個叫出來看。文件是活的，
核准一個 hunk 就會改寫、版本號會跳。

### 現在跑得起來的東西

```
pnpm test        # 367 unit
pnpm test:rwd    # 140 項第 2 層（8 skipped），四組視窗
pnpm typecheck   # 4 projects
```

`rwd.spec.ts` 裡那條寫死 `toHaveCount(8)` 的導覽列斷言改成了下限 +「每一條都
看得見」。面板數量不是那條測試要講的事，把它釘死等於每加一個面板就先收到一個
與它無關的紅燈。

### 仍然沒做

- `undoDocument` 連按兩次是 redo，不是回到兩步前：它永遠取 `history[0]`，而
  undo 本身會把當前 body 推進 history。需要一個游標，或一個明確的 `toRevision`。
- `editDocument` 在 `requestCard` await 之後沿用 await 之前讀到的 body，
  而它上面的註解說它重讀了。store 的 revision 檢查擋得住，但那條路是 throw，
  不是模型讀得懂再重試的 rejection。
- 引用記了 `revision`，沒有人比對它。欄位在，機制不在。
- 第 3 層（真機）依然沒跑，也依然沒有人用人眼看過這些介面。
