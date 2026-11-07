// Agent-surface components: the parts of a chat UI that exist because an agent
// is on the other end — thinking states, activity orbs, streamed text, code
// blocks, to-do lists and the rich composer.
//
// These are deliberately standalone and prop-driven: they render whatever the
// host passes, so they work inside this framework's Thread as well as in an app
// that only wants one of them.

export {
  Orb,
  ORB_TASKS,
  ORB_VARIANTS,
  LATTICE_VARIANTS,
  LENS_VARIANTS,
  RING_VARIANTS,
  HELIX_VARIANTS,
  MORPH_VARIANTS,
  type OrbProps,
  type OrbVariant,
  type LatticeVariant,
  type LensVariant,
  type RingVariant,
  type HelixVariant,
  type MorphVariant,
} from "./Orb.js";

export { Thinking, ThinkingState, type ThinkingProps } from "./Thinking.js";
export { StreamingText, Caret, type StreamingTextProps } from "./StreamingText.js";
export { CodeBlock, type CodeBlockProps } from "./CodeBlock.js";
export { TodoList, type TodoListProps, type TodoItem, type TodoStatus } from "./TodoList.js";
export { RollingCount } from "./RollingCount.js";
export {
  PlanProgress,
  type PlanProgressProps,
  type PlanStep,
  type PlanStepStatus,
} from "./PlanProgress.js";
export {
  AgentInput,
  type AgentInputProps,
  type AgentModel,
  type AgentSkill,
  type AgentAttachment,
} from "./AgentInput.js";
