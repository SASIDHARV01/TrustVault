const LOCAL_DATABASE_URL =
  "postgresql://trustvault:trustvault@localhost:5432/trustvault";

export function getRuntimeDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (databaseUrl) {
    return databaseUrl;
  }

  if (environment.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }

  return LOCAL_DATABASE_URL;
}
