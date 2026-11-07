export * from "./types.js";
export { outlineOf, spanOf, searchBlocks, applyEdits, hunksOf, type EditHunk } from "./edit.js";
export { createMemoryDocumentStore, createLocalDocumentStore } from "./store.js";
export { createDocumentTools, createEmailDraftTool, type DocumentToolsOptions } from "./tools.js";
export { buildMailto, buildEml, emlFilename, MAILTO_SAFE_LENGTH, type MailtoLink } from "./email.js";
