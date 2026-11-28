import { describe, expect, it } from "vitest";
import { describeCutOff, findLoop, LoopGuard } from "./loopGuard";

const prose = (n: number) =>
  Array.from({ length: n }, (_, i) => `Line ${i}: after Nf3 the knight on f3 covers e5 and d4, so ${i % 7} pawns stay safe. `).join("");

describe("findLoop", () => {
  it("finds a short unit repeated many times", () => {
    expect(findLoop(prose(5) + "Q? ".repeat(400))?.trim()).toBe("Q?");
  });

  it("finds a paragraph repeated three times", () => {
    const para = "Let me check again. If Qxb2 then Rb1 and the queen is trapped? No, Qa3 escapes. So Qxb2 is safe. ".repeat(4);
    expect(para.length).toBeGreaterThan(300);
    expect(findLoop(prose(10) + para.repeat(3))).not.toBeNull();
  });

  it("leaves ordinary reasoning alone, even long and with repeated phrases", () => {
    expect(findLoop(prose(400))).toBeNull();
    expect(findLoop("Candidate: Nf3. Candidate: Nc3. Candidate: e4. ".repeat(3) + prose(20))).toBeNull();
  });

  it("needs at least 1000 characters of repetition", () => {
    expect(findLoop(prose(5) + "ab".repeat(100))).toBeNull();
    expect(findLoop(prose(5) + "ab".repeat(600))).not.toBeNull();
  });
});

describe("LoopGuard", () => {
  it("stops a looping stream and names the repeated text", () => {
    const g = new LoopGuard();
    let cut = null;
    let pushed = 0;
    g.push("reasoning", prose(20));
    for (; pushed < 2000 && !cut; pushed++) cut = g.push("reasoning", "Q? ");
    expect(cut).toMatchObject({ reason: "loop", sample: expect.stringContaining("Q?") });
    expect(pushed).toBeLessThan(800);
    expect(describeCutOff(cut!)).toMatch(/^Stopped the reply: it was repeating itself \("Q\?/);
  });

  it("stops a stream that runs past the length limit", () => {
    const g = new LoopGuard(4_000);
    expect(g.push("reasoning", prose(30))).toBeNull();
    expect(g.push("content", prose(30))).toMatchObject({ reason: "length" });
  });

  it("checks reasoning and reply text separately", () => {
    const g = new LoopGuard();
    // Alternating pieces don't make a loop in either text.
    let cut = null;
    for (let i = 0; i < 200 && !cut; i++) cut = g.push(i % 2 ? "content" : "reasoning", prose(1).replace("0", String(i)));
    expect(cut).toBeNull();
  });
});
