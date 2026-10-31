import { describe, expect, it } from "vitest";
import {
  isForSupport,
  isSpam,
  newMessageId,
  parseAddress,
  referencesFor,
  replySubject,
  supportAddress,
  threadingIds,
} from "./support";

describe("supportAddress", () => {
  it("defaults to support@curios.my", () => {
    expect(supportAddress({})).toBe("support@curios.my");
  });
  it("trims and lower-cases SUPPORT_EMAIL", () => {
    expect(supportAddress({ SUPPORT_EMAIL: "  Help@Curios.my " })).toBe(
      "help@curios.my",
    );
  });
});

describe("parseAddress", () => {
  it("handles a bare address", () => {
    expect(parseAddress("Lina@Example.com")).toEqual({
      address: "lina@example.com",
      name: null,
    });
  });
  it("handles Name <a@b>", () => {
    expect(parseAddress("Lina Kek <Lina@Example.com>")).toEqual({
      address: "lina@example.com",
      name: "Lina Kek",
    });
  });
  it("handles a quoted name containing a comma", () => {
    expect(parseAddress('"Lina, Kek" <Lina@Example.com>')).toEqual({
      address: "lina@example.com",
      name: "Lina, Kek",
    });
  });
  it("handles <a@b> with no name", () => {
    expect(parseAddress("<a@b.com>")).toEqual({
      address: "a@b.com",
      name: null,
    });
  });
});

describe("isForSupport", () => {
  it("matches received_for case-insensitively", () => {
    expect(
      isForSupport(
        { to: ["hello@curios.my"], received_for: ["Support@Curios.my"] },
        "support@curios.my",
      ),
    ).toBe(true);
  });
  it("matches a display-name to or cc", () => {
    expect(
      isForSupport({ cc: ["Curios <support@curios.my>"] }, "support@curios.my"),
    ).toBe(true);
  });
  it("is false when the support address is absent", () => {
    expect(isForSupport({ to: ["hello@curios.my"] }, "support@curios.my")).toBe(
      false,
    );
  });
});

describe("replySubject", () => {
  it("adds Re:", () => {
    expect(replySubject("Help")).toBe("Re: Help");
  });
  it("keeps an existing re: in any case", () => {
    expect(replySubject("RE: Help")).toBe("RE: Help");
    expect(replySubject("re: Help")).toBe("re: Help");
  });
  it("handles an empty subject", () => {
    expect(replySubject("")).toBe("Re: (no subject)");
  });
});

describe("threadingIds", () => {
  it("reads In-Reply-To then References, de-duplicated, case-insensitive names", () => {
    expect(
      threadingIds({ "in-reply-to": "<a@x>", References: "<b@x> <a@x>" }),
    ).toEqual(["<a@x>", "<b@x>"]);
  });
  it("accepts array values and missing headers", () => {
    expect(threadingIds({ references: ["<a@x> <b@x>", "<c@x>"] })).toEqual([
      "<a@x>",
      "<b@x>",
      "<c@x>",
    ]);
    expect(threadingIds({})).toEqual([]);
  });
});

describe("referencesFor", () => {
  it("keeps the last 20, oldest first", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `<${i}@x>`);
    const out = referencesFor(ids);
    expect(out).toHaveLength(20);
    expect(out[0]).toBe("<5@x>");
    expect(out[19]).toBe("<24@x>");
  });
  it("de-duplicates", () => {
    expect(referencesFor(["<a@x>", "<b@x>", "<a@x>"])).toEqual([
      "<a@x>",
      "<b@x>",
    ]);
  });
});

describe("newMessageId", () => {
  it("is a bracketed unique id on the domain", () => {
    expect(newMessageId()).toMatch(/^<[0-9a-f-]{36}@curios\.my>$/);
    expect(newMessageId("x.test")).toMatch(/@x\.test>$/);
    expect(newMessageId()).not.toBe(newMessageId());
  });
});

describe("isSpam", () => {
  it("is false for anything unparsable", () => {
    expect(isSpam(null)).toBe(false);
    expect(isSpam(undefined)).toBe(false);
    expect(isSpam("fail")).toBe(false);
    expect(
      isSpam({
        spf: { result: "fail" },
        dkim: { result: "fail" },
        dmarc: { result: "fail" },
      }),
    ).toBe(false);
  });
  it("is true when DMARC fails", () => {
    expect(isSpam({ spf: "pass", dkim: "pass", dmarc: "fail" })).toBe(true);
  });
  it("is false when DMARC passes even if SPF and DKIM fail", () => {
    expect(isSpam({ spf: "fail", dkim: "fail", dmarc: "pass" })).toBe(false);
  });
  it("is true when DMARC is absent or unknown and SPF and DKIM both fail", () => {
    expect(isSpam({ spf: "fail", dkim: "fail" })).toBe(true);
    expect(isSpam({ spf: "fail", dkim: "fail", dmarc: "unknown" })).toBe(true);
  });
  it("is false for SPF fail with DKIM pass", () => {
    expect(isSpam({ spf: "fail", dkim: "pass" })).toBe(false);
  });
});
