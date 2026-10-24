import "dotenv/config";

import { Buffer } from "node:buffer";

import { expect, test, type APIResponse, type Browser, type BrowserContext } from "@playwright/test";

type Credentials = { email: string; password: string };

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live storage E2E suite.`);
  return value;
}

const liveStorageEnabled = process.env.LIVE_R2_E2E === "1";

test.skip(!liveStorageEnabled, "Set LIVE_R2_E2E=1 to use real Supabase and Cloudflare R2 services.");
test.setTimeout(180_000);

const owner: Credentials = {
  email: required("DEMO_OWNER_EMAIL"),
  password: required("DEMO_OWNER_PASSWORD"),
};
const viewer: Credentials = {
  email: required("DEMO_VIEWER_EMAIL"),
  password: required("DEMO_VIEWER_PASSWORD"),
};
const administrator: Credentials = {
  email: required("DEMO_ADMIN_EMAIL"),
  password: required("DEMO_ADMIN_PASSWORD"),
};

async function authenticatedPage(browser: Browser, credentials: Credentials) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Enter the vault" }).click();
  await expect(page).toHaveURL(/\/vault$/, { timeout: 30_000 });
  return { context, page };
}

function mutationHeaders(contentType = "application/json") {
  return {
    Origin: required("APP_URL"),
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

async function expectStatus(response: APIResponse, status: number) {
  const responseBody = await response.body();
  expect(
    response.status(),
    `Expected HTTP ${status}, received ${response.status()}: ${responseBody.toString("utf8")}`,
  ).toBe(status);
  return responseBody;
}

async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

test("proves the real Supabase and private R2 document lifecycle", async ({ browser }) => {
  const ownerSession = await authenticatedPage(browser, owner);
  const viewerSession = await authenticatedPage(browser, viewer);
  const adminSession = await authenticatedPage(browser, administrator);
  const contexts = [ownerSession.context, viewerSession.context, adminSession.context];

  try {
    const marker = `live-r2-${Date.now()}`;
    const pdfBytes = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
      "utf8",
    );

    let documentId = "";
    let versionId = "";
    let grantId = "";
    let checkpointId = "";

    await test.step("owner creates metadata in Supabase", async () => {
      const response = await ownerSession.page.request.post("/api/documents", {
        headers: mutationHeaders(),
        data: {
          name: `Pre-deployment R2 verification ${marker}`,
          description: "Tiny persistent evidence created by the intentional live-provider E2E test.",
          categoryId: null,
        },
      });
      await expectStatus(response, 201);
      const body = await response.json() as { data: { document: { id: string } } };
      documentId = body.data.document.id;
      expect(documentId).toBeTruthy();
    });

    await test.step("owner uploads a PDF to private R2", async () => {
      const response = await ownerSession.page.request.post(
        `/api/documents/${documentId}/versions`,
        {
          headers: mutationHeaders(""),
          multipart: {
            file: {
              name: "trustvault-live-verification.pdf",
              mimeType: "application/pdf",
              buffer: pdfBytes,
            },
          },
        },
      );
      await expectStatus(response, 201);
      const body = await response.json() as {
        data: { version: { id: string; sizeBytes: number; storageKey?: string } };
      };
      versionId = body.data.version.id;
      expect(body.data.version.sizeBytes).toBe(pdfBytes.byteLength);
      expect(body.data.version).not.toHaveProperty("storageKey");
    });

    await test.step("owner previews and downloads integrity-checked R2 bytes", async () => {
      const preview = await ownerSession.page.request.get(
        `/api/documents/${documentId}/versions/${versionId}/content`,
      );
      expect(await expectStatus(preview, 200)).toEqual(pdfBytes);
      expect(preview.headers()["content-type"]).toBe("application/pdf");
      expect(preview.headers()["content-disposition"]).toContain("inline");
      expect(preview.headers()["cache-control"]).toBe("private, no-store");

      const download = await ownerSession.page.request.get(
        `/api/documents/${documentId}/versions/${versionId}/content?disposition=attachment`,
      );
      expect(await expectStatus(download, 200)).toEqual(pdfBytes);
      expect(download.headers()["content-disposition"]).toContain("attachment");
    });

    await test.step("READ sharing lets the viewer retrieve the same bytes", async () => {
      const grant = await ownerSession.page.request.post(`/api/documents/${documentId}/grants`, {
        headers: mutationHeaders(),
        data: { recipientEmail: viewer.email, accessLevel: "READ" },
      });
      await expectStatus(grant, 201);
      grantId = ((await grant.json()) as { data: { grant: { id: string } } }).data.grant.id;

      const viewerDownload = await viewerSession.page.request.get(
        `/api/documents/${documentId}/versions/${versionId}/content?disposition=attachment`,
      );
      expect(await expectStatus(viewerDownload, 200)).toEqual(pdfBytes);
    });

    await test.step("revocation blocks the viewer on the very next request", async () => {
      const revoked = await ownerSession.page.request.delete(
        `/api/documents/${documentId}/grants/${grantId}`,
        { headers: mutationHeaders() },
      );
      await expectStatus(revoked, 200);

      const denied = await viewerSession.page.request.get(
        `/api/documents/${documentId}/versions/${versionId}/content?disposition=attachment`,
      );
      await expectStatus(denied, 404);
      expect(await denied.json()).toMatchObject({ error: { code: "DOCUMENT_NOT_FOUND" } });
    });

    await test.step("administrator needs a reason for the audited content override", async () => {
      const missingReason = await adminSession.page.request.get(
        `/api/documents/${documentId}/versions/${versionId}/content`,
      );
      await expectStatus(missingReason, 404);

      const overridden = await adminSession.page.request.get(
        `/api/documents/${documentId}/versions/${versionId}/content`,
        { headers: { "X-TrustVault-Override-Reason": "Pre-deployment live R2 verification" } },
      );
      expect(await expectStatus(overridden, 200)).toEqual(pdfBytes);
    });

    await test.step("administrator writes and lists an R2-backed audit checkpoint", async () => {
      const created = await adminSession.page.request.post("/api/admin/audit/checkpoints", {
        headers: mutationHeaders(),
      });
      await expectStatus(created, 201);
      checkpointId = ((await created.json()) as {
        data: { checkpoint: { id: string } };
      }).data.checkpoint.id;

      const listed = await adminSession.page.request.get("/api/admin/audit/checkpoints");
      await expectStatus(listed, 200);
      const body = await listed.json() as {
        data: { checkpoints: Array<{ id: string }> };
      };
      expect(body.data.checkpoints.map((checkpoint) => checkpoint.id)).toContain(checkpointId);

      const verification = await adminSession.page.request.post("/api/admin/audit/verify", {
        headers: mutationHeaders(),
      });
      await expectStatus(verification, 200);
      expect(await verification.json()).toMatchObject({
        data: { verification: { valid: true } },
      });
    });

    test.info().annotations.push(
      { type: "documentId", description: documentId },
      { type: "versionId", description: versionId },
      { type: "checkpointId", description: checkpointId },
    );
  } finally {
    await closeAll(contexts);
  }
});
