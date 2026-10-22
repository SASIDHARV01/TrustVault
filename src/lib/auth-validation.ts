import { z } from "zod";

const email = z.string().trim().email("Enter a valid email address.");
const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const registrationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must contain at least 2 characters.")
    .max(120, "Name must be 120 characters or fewer."),
  email,
  password,
});

export function firstValidationError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the information and try again.";
}
