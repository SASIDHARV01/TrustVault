import "server-only";

export type R2Jurisdiction = "default" | "eu" | "fedramp" | "us";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  jurisdiction: R2Jurisdiction;
  endpoint: string;
};

type StorageEnvironment = Readonly<Record<string, string | undefined>>;

function required(environment: StorageEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value || value.startsWith("replace-with-")) {
    throw new Error(`${name} is required at runtime.`);
  }
  return value;
}

function endpoint(accountId: string, jurisdiction: R2Jurisdiction) {
  const jurisdictionPart = jurisdiction === "default" ? "" : `.${jurisdiction}`;
  return `https://${accountId}${jurisdictionPart}.r2.cloudflarestorage.com`;
}

export function getR2Config(
  environment: StorageEnvironment = process.env,
): R2Config {
  const accountId = required(environment, "R2_ACCOUNT_ID");
  const accessKeyId = required(environment, "R2_ACCESS_KEY_ID");
  const secretAccessKey = required(environment, "R2_SECRET_ACCESS_KEY");
  const bucket = required(environment, "R2_BUCKET_NAME");
  const jurisdiction = (environment.R2_JURISDICTION?.trim().toLowerCase() ||
    "default") as R2Jurisdiction;

  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.");
  }
  if (!/^[a-f0-9]{32}$/.test(accessKeyId)) {
    throw new Error("R2_ACCESS_KEY_ID must be a 32-character R2 access key ID.");
  }
  if (!/^[a-f0-9]{64}$/.test(secretAccessKey)) {
    throw new Error("R2_SECRET_ACCESS_KEY must be a 64-character R2 secret.");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket)) {
    throw new Error(
      "R2_BUCKET_NAME must be 3-63 lowercase letters, numbers, or hyphens.",
    );
  }
  if (!["default", "eu", "fedramp", "us"].includes(jurisdiction)) {
    throw new Error("R2_JURISDICTION must be default, eu, fedramp, or us.");
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    jurisdiction,
    endpoint: endpoint(accountId, jurisdiction),
  };
}
