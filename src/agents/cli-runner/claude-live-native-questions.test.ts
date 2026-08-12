import { describe, expect, it } from "vitest";
import {
  buildNativeQuestionRelay,
  shouldRelayNativeQuestion,
} from "./claude-live-native-questions.js";

describe("shouldRelayNativeQuestion", () => {
  it("matches the interactive prompt tools and nothing else", () => {
    expect(shouldRelayNativeQuestion("AskUserQuestion")).toBe(true);
    expect(shouldRelayNativeQuestion("ExitPlanMode")).toBe(true);
    expect(shouldRelayNativeQuestion("Bash")).toBe(false);
    expect(shouldRelayNativeQuestion("")).toBe(false);
  });
});

describe("buildNativeQuestionRelay", () => {
  it("renders an AskUserQuestion block with numbered options and a select hint", () => {
    const message = buildNativeQuestionRelay("AskUserQuestion", {
      questions: [
        {
          question: "Which database should we use?",
          header: "DB",
          multiSelect: false,
          options: [
            { label: "Postgres", description: "Relational" },
            { label: "SQLite", description: "Embedded" },
          ],
        },
      ],
    });
    expect(message).not.toBeNull();
    expect(message).toContain("Which database should we use?");
    expect(message).toContain("1. Postgres — Relational");
    expect(message).toContain("2. SQLite — Embedded");
    expect(message).toContain("(Select one.)");
    expect(message).toContain("Do not call AskUserQuestion again.");
  });

  it("numbers multiple questions and marks multi-select", () => {
    const message = buildNativeQuestionRelay("AskUserQuestion", {
      questions: [
        { question: "First?", options: [{ label: "A" }] },
        {
          question: "Second?",
          multiSelect: true,
          options: [{ label: "B" }, { label: "C" }],
        },
      ],
    });
    expect(message).toContain("Question 1: First?");
    expect(message).toContain("Question 2: Second?");
    expect(message).toContain("(Select all that apply.)");
  });

  it("renders a single question without an index prefix and tolerates missing options", () => {
    const message = buildNativeQuestionRelay("AskUserQuestion", {
      questions: [{ question: "Proceed?" }],
    });
    expect(message).toContain("Question: Proceed?");
    expect(message).not.toContain("Question 1:");
  });

  it("renders an ExitPlanMode plan for approval", () => {
    const message = buildNativeQuestionRelay("ExitPlanMode", {
      plan: "1. Do the thing\n2. Do the other thing",
    });
    expect(message).not.toBeNull();
    expect(message).toContain("approve it or request changes");
    expect(message).toContain("1. Do the thing");
    expect(message).toContain("Do not call ExitPlanMode again.");
  });

  it("returns null for malformed or empty input so the caller can fall through", () => {
    expect(buildNativeQuestionRelay("AskUserQuestion", {})).toBeNull();
    expect(buildNativeQuestionRelay("AskUserQuestion", { questions: [] })).toBeNull();
    expect(buildNativeQuestionRelay("AskUserQuestion", { questions: [{}] })).toBeNull();
    expect(buildNativeQuestionRelay("ExitPlanMode", { plan: "   " })).toBeNull();
    expect(buildNativeQuestionRelay("Bash", { questions: [{ question: "x" }] })).toBeNull();
  });
});
