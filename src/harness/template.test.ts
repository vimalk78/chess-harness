import { describe, expect, it, vi } from "vitest";
import { renderTemplate, templateVariables } from "./template";

describe("renderTemplate", () => {
  it("substitutes known variables, allowing whitespace inside braces", () => {
    expect(renderTemplate("You are {{side}}. FEN: {{ fen }}", { side: () => "White", fen: () => "x" })).toBe("You are White. FEN: x");
  });

  it("leaves unknown variables untouched", () => {
    expect(renderTemplate("A {{nope}} B", {})).toBe("A {{nope}} B");
  });

  it("computes each variable once, and only if used", () => {
    const used = vi.fn(() => "u");
    const unused = vi.fn(() => "n");
    expect(renderTemplate("{{a}} {{a}}", { a: used, b: unused })).toBe("u u");
    expect(used).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
  });

  it("does not re-expand braces that appear inside a value", () => {
    expect(renderTemplate("{{a}}", { a: () => "{{b}}", b: () => "no" })).toBe("{{b}}");
  });
});

describe("templateVariables", () => {
  it("lists distinct variable names in order", () => {
    expect(templateVariables("{{fen}} {{ pgn }} {{fen}} {not} {{bad name}}")).toEqual(["fen", "pgn"]);
  });
});
