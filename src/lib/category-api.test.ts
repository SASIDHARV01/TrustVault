import { describe, expect, it } from "vitest";

import {
  categoryIdSchema,
  createCategorySchema,
  normalizedCategoryName,
  updateCategorySchema,
} from "./category-api";

describe("category API validation", () => {
  it("normalizes Unicode and repeated whitespace deterministically", () => {
    const parsed = createCategorySchema.parse({ name: "  Project　 Alpha  " });
    expect(parsed.name).toBe("Project Alpha");
    expect(normalizedCategoryName(parsed.name)).toBe("project alpha");
  });

  it.each([
    {},
    { name: "" },
    { name: "a".repeat(81) },
    { name: "Finance\u0000" },
    { name: "Finance", ownerId: "attacker" },
  ])("rejects invalid or privileged category input %#", (input) => {
    expect(createCategorySchema.safeParse(input).success).toBe(false);
  });

  it("requires a name for updates and rejects path-like identifiers", () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(false);
    expect(categoryIdSchema.safeParse("../category").success).toBe(false);
    expect(categoryIdSchema.safeParse("category_123").success).toBe(true);
  });
});
