// Surfaces: agent-composed interfaces. See types.ts for the design.
export * from "./types.js";
export { parsePointer, getAt, setAt, removeAt } from "./pointer.js";
export { findUnsafe, isScriptUrl, safeSurfaceUrl, type UnsafeFinding } from "./safety.js";
export { checkSchema, type SchemaProblem, type SchemaCheckOptions } from "./schema-check.js";
export {
  isSurfaceBinding,
  usesBinding,
  formatTemplate,
  runSurfaceQuery,
  resolveSurfaceValue,
  resolveSurfaceAction,
  evaluateSurfaceCondition,
  bindingProblems,
  type BindingScope,
} from "./bindings.js";
export { SURFACE_PRIMITIVES } from "./primitives.js";
export {
  SurfaceCatalogue,
  CARD_COMPONENT,
  CARD_ENTRY_PREFIX,
  type SurfaceCatalogueOptions,
  type SurfaceComponentCategory,
  type SurfaceComponentDefinition,
} from "./catalogue.js";
export {
  isSurfaceId,
  validateSurfaceAction,
  validateSurfaceComponent,
  validateSurfaceComponents,
  validateSurfaceGraph,
  type SurfaceValidationContext,
} from "./validate.js";
export {
  buildSurface,
  applySurfaceOperations,
  previewSurface,
  sanitizeSurfaceSpec,
  type SurfaceBuildContext,
  type SurfaceBuildResult,
} from "./operations.js";
export { SurfaceLedger, foldSurfaces, isSurfaceSpec, surfaceCardId, SURFACE_ARTIFACT_KIND } from "./ledger.js";
export { createSurfaceTools, SURFACE_GUIDE, SURFACE_TOOL_NAMES, type SurfaceToolsOptions } from "./tools.js";
export { createSurfaceSkill, createSurfaceContextSource, SURFACE_SKILL_ID } from "./disclosure.js";
export {
  surfaceActionTools,
  authorizeSurfaceTool,
  runSurfaceToolAction,
  type SurfaceToolAuthorization,
  type SurfaceToolRunConfig,
} from "./action-run.js";
export { toA2uiMessages, A2UI_VERSION, SURFACE_A2UI_CATALOG_ID, type A2uiMessage } from "./a2ui.js";
