import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTHENTICATED_PATH,
  getLoginPath,
  getSafeCallbackPath,
  isAccountActive,
  isAdministrator,
} from "./auth-policy";

describe("authentication policy", () => {
  it.each([
    undefined,
    null,
    "",
    "vault",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
  ])(
    "rejects unsafe callback value %s",
    (value) => {
      expect(getSafeCallbackPath(value)).toBe(DEFAULT_AUTHENTICATED_PATH);
    },
  );

  it("preserves an internal path with its query and hash", () => {
    expect(getSafeCallbackPath("/admin?tab=users#recent")).toBe(
      "/admin?tab=users#recent",
    );
  });

  it("encodes the safe return path in a login URL", () => {
    expect(getLoginPath("/admin?tab=users")).toBe(
      "/login?next=%2Fadmin%3Ftab%3Dusers",
    );
  });

  it("recognizes only the database administrator role", () => {
    expect(isAdministrator("ADMIN")).toBe(true);
    expect(isAdministrator("MEMBER")).toBe(false);
    expect(isAdministrator("admin")).toBe(false);
    expect(isAdministrator(undefined)).toBe(false);
  });

  it("treats any disabled timestamp as an inactive account", () => {
    expect(isAccountActive(null)).toBe(true);
    expect(isAccountActive(undefined)).toBe(true);
    expect(isAccountActive(new Date())).toBe(false);
    expect(isAccountActive("2026-10-22T00:00:00Z")).toBe(false);
  });
});
