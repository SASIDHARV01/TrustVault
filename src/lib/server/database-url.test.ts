import { describe, expect, it } from "vitest";

import { getRuntimeDatabaseUrl } from "./database-url";

describe("getRuntimeDatabaseUrl", () => {
  it("uses the pooled runtime URL when provided", () => {
    expect(
      getRuntimeDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://pooled.example/trustvault",
      }),
    ).toBe("postgresql://pooled.example/trustvault");
  });

  it("fails closed when production has no database URL", () => {
    expect(() => getRuntimeDatabaseUrl({ NODE_ENV: "production" })).toThrow(
      "DATABASE_URL is required in production",
    );
  });

  it("allows the documented local PostgreSQL default outside production", () => {
    expect(getRuntimeDatabaseUrl({ NODE_ENV: "development" })).toBe(
      "postgresql://trustvault:trustvault@localhost:5432/trustvault",
    );
  });
});
