import { isRecord } from "@openclaw/normalization-core/record-coerce";

/**
 * Claude Code's interactive prompt tools cannot be answered when Claude runs as
 * an OpenClaw live stdio backend: the turn's output is delivered to the user as
 * a chat message, not an interactive terminal prompt, so there is no channel to
 * feed a chosen option back into the blocked tool call. Left alone, print-mode
 * Claude self-answers "The user did not answer the questions" and moves on, so
 * the question is silently black-holed.
 *
 * Instead of allowing that (self-answered) or bare-denying (question lost), we
 * render the question authoritatively here and hand it back to Claude in the
 * deny message with an instruction to relay it verbatim and stop. Claude then
 * emits our block as its own assistant text, which flows to the user through the
 * normal turn output — and their next message is the answer.
 */

const ASK_USER_QUESTION_TOOL = "AskUserQuestion";
const EXIT_PLAN_MODE_TOOL = "ExitPlanMode";

// Guardrails against a runaway model input becoming an unbounded deny payload.
const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 12;
const MAX_FIELD_CHARS = 2_000;
const MAX_PLAN_CHARS = 8_000;

/** Whether this native tool is an interactive prompt we relay rather than run. */
export function shouldRelayNativeQuestion(toolName: string): boolean {
  return toolName === ASK_USER_QUESTION_TOOL || toolName === EXIT_PLAN_MODE_TOOL;
}

function coerceText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  // Codepoint-safe slice so truncation never splits a surrogate pair.
  return `${Array.from(trimmed).slice(0, maxChars).join("")}…`;
}

function renderOption(option: unknown, index: number): string | null {
  if (!isRecord(option)) {
    return null;
  }
  const label = coerceText(option.label, MAX_FIELD_CHARS);
  if (!label) {
    return null;
  }
  const description = coerceText(option.description, MAX_FIELD_CHARS);
  return description ? `  ${index}. ${label} — ${description}` : `  ${index}. ${label}`;
}

function renderQuestion(question: unknown, index: number, total: number): string | null {
  if (!isRecord(question)) {
    return null;
  }
  const prompt = coerceText(question.question, MAX_FIELD_CHARS);
  if (!prompt) {
    return null;
  }
  const heading = total > 1 ? `Question ${index + 1}: ${prompt}` : `Question: ${prompt}`;
  const lines = [heading];
  const rawOptions = Array.isArray(question.options) ? question.options.slice(0, MAX_OPTIONS) : [];
  const options = rawOptions
    .map((option, optionIndex) => renderOption(option, optionIndex + 1))
    .filter((line): line is string => line !== null);
  if (options.length > 0) {
    lines.push(...options);
    lines.push(question.multiSelect === true ? "  (Select all that apply.)" : "  (Select one.)");
  }
  return lines.join("\n");
}

function buildAskUserQuestionRelay(toolInput: Record<string, unknown>): string | null {
  const rawQuestions = Array.isArray(toolInput.questions)
    ? toolInput.questions.slice(0, MAX_QUESTIONS)
    : [];
  if (rawQuestions.length === 0) {
    return null;
  }
  const blocks = rawQuestions
    .map((question, index) => renderQuestion(question, index, rawQuestions.length))
    .filter((block): block is string => block !== null);
  if (blocks.length === 0) {
    return null;
  }
  return [
    "[OpenClaw] AskUserQuestion cannot collect an interactive answer in this environment: " +
      "your turn is delivered to the user as a chat message, so this tool always resolves as " +
      "unanswered. Relay the question(s) below to the user as plain text, exactly as written, " +
      "then stop and wait — their next message is the answer. Do not call AskUserQuestion again.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function buildExitPlanModeRelay(toolInput: Record<string, unknown>): string | null {
  const plan = coerceText(toolInput.plan, MAX_PLAN_CHARS);
  if (!plan) {
    return null;
  }
  return [
    "[OpenClaw] Plan mode cannot prompt for approval in this environment. Present the plan " +
      "below to the user as plain text and ask them to approve it or request changes, then stop " +
      "and wait for their reply. Do not call ExitPlanMode again.",
    "",
    plan,
  ].join("\n");
}

/**
 * Build the deny message that carries the rendered prompt back to Claude, or
 * `null` when the tool input is malformed (fall through to normal handling).
 */
export function buildNativeQuestionRelay(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (toolName === ASK_USER_QUESTION_TOOL) {
    return buildAskUserQuestionRelay(toolInput);
  }
  if (toolName === EXIT_PLAN_MODE_TOOL) {
    return buildExitPlanModeRelay(toolInput);
  }
  return null;
}
