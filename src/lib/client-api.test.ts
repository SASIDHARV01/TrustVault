import { describe, expect, it } from "vitest";

import { formatBytes, queryString } from "@/lib/client-api";

describe("client API helpers", () => {
  it("serializes only populated allowlisted query values", () => {
    expect(queryString({ q: "salary letter", categoryId: "", page: 2, limit: undefined }))
      .toBe("?q=salary+letter&page=2");
  });

  it("returns an empty suffix when no query values are present", () => {
    expect(queryString({ q: "", page: undefined })).toBe("");
  });

  it("formats document sizes without overstating precision", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
