import { describe, expect, it } from "vitest";
import { splitMessage } from "@/lib/linkedin/split-message";

describe("split messages into a conversation", () => {
  it("splits on paragraphs, 2-4 parts, never mid-sentence", () => {
    expect(splitMessage("Hi Ahmed,\n\nCongrats on the new role.\n\nHow do you host learner data?")).toEqual(["Hi Ahmed,", "Congrats on the new role.", "How do you host learner data?"]);
    expect(splitMessage("One paragraph only. Two sentences.")).toEqual(["One paragraph only. Two sentences."]);
    expect(splitMessage("a\n\nb\n\nc\n\nd\n\ne")).toEqual(["a", "b", "c", "d\n\ne"]);
  });
});
