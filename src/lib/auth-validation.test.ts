import { describe, expect, it } from "vitest";

import { loginSchema, registrationSchema } from "./auth-validation";

describe("authentication input validation", () => {
  it("accepts a normalized registration", () => {
    expect(
      registrationSchema.parse({
        name: "  Sasi Dhar  ",
        email: "  sasi@example.com  ",
        password: "a-secure-demo-password",
      }),
    ).toEqual({
      name: "Sasi Dhar",
      email: "sasi@example.com",
      password: "a-secure-demo-password",
    });
  });

  it("rejects weak registration passwords", () => {
    expect(
      registrationSchema.safeParse({
        name: "Sasi Dhar",
        email: "sasi@example.com",
        password: "short",
      }).success,
    ).toBe(false);
  });

  it("requires valid login fields without applying signup password policy", () => {
    expect(loginSchema.safeParse({ email: "bad", password: "" }).success).toBe(
      false,
    );
  });
});
