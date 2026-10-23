import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

type Credentials = { email: string; password: string };

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the security E2E suite.`);
  return value;
}

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

async function authenticatedPage(
  browser: Browser,
  credentials: Credentials,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Enter the vault" }).click();
  await expect(page).toHaveURL(/\/vault$/);
  return { context, page };
}

function mutationHeaders() {
  return {
    Origin: required("APP_URL"),
    "Content-Type": "application/json",
  };
}

async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((context) => context.close()));
}

test("enforces cross-user, revocation, CSRF, XSS, admin, cache and audit boundaries", async ({ browser }) => {
  const ownerSession = await authenticatedPage(browser, owner);
  const viewerSession = await authenticatedPage(browser, viewer);
  const adminSession = await authenticatedPage(browser, administrator);
  const contexts = [ownerSession.context, viewerSession.context, adminSession.context];

  try {
    const marker = `phase9-${Date.now()}`;
    const hostileName = `<img src=x onerror=window.__trustvault_xss=1> ${marker}`;

    await test.step("owner creates literal hostile text without browser execution", async () => {
      const created = await ownerSession.page.request.post("/api/documents", {
        headers: mutationHeaders(),
        data: { name: hostileName, description: "Phase 9 attack fixture", categoryId: null },
      });
      expect(created.status()).toBe(201);
      const body = await created.json() as { data: { document: { id: string } } };
      test.info().annotations.push({ type: "documentId", description: body.data.document.id });
    });

    const annotation = test.info().annotations.find((item) => item.type === "documentId");
    const documentId = annotation?.description;
    expect(documentId).toBeTruthy();

    await test.step("ungranted viewer cannot discover or mutate an owner's document", async () => {
      const detail = await viewerSession.page.request.get(`/api/documents/${documentId}`);
      expect(detail.status()).toBe(404);
      expect(detail.headers()["cache-control"]).toBe("private, no-store");

      const update = await viewerSession.page.request.patch(`/api/documents/${documentId}`, {
        headers: mutationHeaders(),
        data: { name: "stolen" },
      });
      const remove = await viewerSession.page.request.delete(`/api/documents/${documentId}`, {
        headers: mutationHeaders(),
      });
      const grants = await viewerSession.page.request.get(`/api/documents/${documentId}/grants`);
      expect([update.status(), remove.status(), grants.status()]).toEqual([404, 404, 404]);
    });

    await test.step("cross-site mutation is rejected even for the owner", async () => {
      const response = await ownerSession.page.request.patch(`/api/documents/${documentId}`, {
        headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" },
        data: { name: "csrf-success" },
      });
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "UNTRUSTED_ORIGIN" },
      });
    });

    let grantId = "";
    await test.step("READ works, mutation does not, and revocation applies next request", async () => {
      const grant = await ownerSession.page.request.post(`/api/documents/${documentId}/grants`, {
        headers: mutationHeaders(),
        data: { recipientEmail: viewer.email, accessLevel: "READ" },
      });
      expect(grant.status()).toBe(201);
      grantId = ((await grant.json()) as { data: { grant: { id: string } } }).data.grant.id;

      expect((await viewerSession.page.request.get(`/api/documents/${documentId}`)).status()).toBe(200);
      expect((await viewerSession.page.request.patch(`/api/documents/${documentId}`, {
        headers: mutationHeaders(),
        data: { name: "read-cannot-edit" },
      })).status()).toBe(404);

      const revoked = await ownerSession.page.request.delete(
        `/api/documents/${documentId}/grants/${grantId}`,
        { headers: mutationHeaders() },
      );
      expect(revoked.status()).toBe(200);
      expect((await viewerSession.page.request.get(`/api/documents/${documentId}`)).status()).toBe(404);
    });

    await test.step("administrator metadata visibility grants no owner mutation powers", async () => {
      const listing = await adminSession.page.request.get(`/api/documents?q=${encodeURIComponent(marker)}`);
      expect(listing.status()).toBe(200);
      expect(await listing.text()).toContain(documentId!);

      const update = await adminSession.page.request.patch(`/api/documents/${documentId}`, {
        headers: mutationHeaders(),
        data: { name: "admin-overreach" },
      });
      const remove = await adminSession.page.request.delete(`/api/documents/${documentId}`, {
        headers: mutationHeaders(),
      });
      expect([update.status(), remove.status()]).toEqual([404, 404]);
    });

    await test.step("React renders document names as text under a nonce CSP", async () => {
      await ownerSession.page.goto(`/vault`);
      await ownerSession.page.getByLabel("Search documents").fill(marker);
      await expect(ownerSession.page.getByText(hostileName, { exact: true })).toBeVisible();
      await expect(ownerSession.page.locator("img[src='x']")).toHaveCount(0);
      expect(await ownerSession.page.evaluate(() => (window as typeof window & { __trustvault_xss?: number }).__trustvault_xss)).toBeUndefined();

      const protectedResponse = await ownerSession.page.request.get("/vault");
      const policy = protectedResponse.headers()["content-security-policy"] ?? "";
      expect(policy).toContain("'strict-dynamic'");
      expect(policy).toContain("'nonce-");
      expect(policy).not.toContain("'unsafe-inline'");
      expect(protectedResponse.headers()["cache-control"]).toContain("no-store");
    });

    await test.step("anonymous workspace navigation is redirected to sign in", async () => {
      const anonymous = await browser.newContext();
      contexts.push(anonymous);
      const page = await anonymous.newPage();
      await page.goto("/vault");
      await expect(page).toHaveURL(/\/login\?next=/);
    });

    await test.step("denied decisions are visible and the audit chain verifies", async () => {
      const activity = await adminSession.page.request.get("/api/admin/activity?outcome=DENIED&limit=50");
      expect(activity.status()).toBe(200);
      const activityText = await activity.text();
      expect(activityText).toContain(documentId!);

      const verification = await adminSession.page.request.post("/api/admin/audit/verify", {
        headers: mutationHeaders(),
      });
      expect(verification.status()).toBe(200);
      expect(await verification.json()).toMatchObject({
        data: { verification: { valid: true } },
      });
    });

    await test.step("expensive audit verification eventually returns a controlled 429", async () => {
      let limited = false;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await adminSession.page.request.post("/api/admin/audit/verify", {
          headers: mutationHeaders(),
        });
        if (response.status() === 429) {
          limited = true;
          expect(response.headers()["retry-after"]).toBeTruthy();
          expect(await response.json()).toMatchObject({
            error: { code: "RATE_LIMITED" },
          });
          break;
        }
        expect(response.status()).toBe(200);
      }
      expect(limited).toBe(true);
    });
  } finally {
    await closeAll(contexts);
  }
});
