import "dotenv/config";

import { defineConfig } from "prisma/config";

const localDevelopmentUrl =
  "postgresql://trustvault:trustvault@localhost:5432/trustvault";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations must bypass the Supabase transaction pooler. Schema-only
    // commands safely fall back to the documented local development database.
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      localDevelopmentUrl,
  },
});
