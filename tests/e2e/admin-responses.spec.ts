import { test, expect } from "@playwright/test";
import {
  testEmail,
  grantTestAdmin,
  revokeTestAdmin,
  deleteAuthUserByEmail,
  countAuthUsersByEmail,
  sweepStaleTestData,
  signInAsTestUser,
} from "../support/supabase-admin";
import {
  createTestRound,
  deleteTestRound,
  seedRoundResponses,
  signInViaCodePage,
  type TestRound,
} from "../support/survey-fixtures";
import { ADMIN_MESSAGES } from "../../src/lib/admin/messages";
import { toRoundCsv } from "../../src/lib/admin/csv";
import { pivotResponses, type AdminResponseRow } from "../../src/lib/admin/responses";

/**
 * ADM-02's UI half: an admin opens a round's responses and sees each
 * participant by email with their answers, started/submitted status, and
 * answered count; expanding a row shows every statement's answer or "Not
 * answered"; an email filter narrows the rows; an empty round shows the
 * empty state. Task 3 extends this file with the CSV export route, the
 * download, and the guard/privacy cases.
 */
test.describe.serial("admin responses @admin-responses", () => {
  const adminEmail = testEmail("admin", "resp");
  const paEmail = testEmail("participant", "ra");
  const pbEmail = testEmail("participant", "rb");
  const pcEmail = testEmail("participant", "rc");
  const guardEmail = testEmail("participant", "rg");

  let closedRound: TestRound;
  let emptyRound: TestRound;

  test.beforeAll(async () => {
    await sweepStaleTestData();
    await grantTestAdmin(adminEmail);

    closedRound = await createTestRound({
      window: "closed",
      statementCount: 2,
    });
    await seedRoundResponses(closedRound.roundId, [
      {
        email: paEmail,
        answers: { e2e_01: 1, e2e_02: 2 },
        submit: true,
      },
      { email: pbEmail, answers: { e2e_01: 3 }, submit: false },
      { email: pcEmail, answers: {}, submit: false },
    ]);

    emptyRound = await createTestRound({ window: "closed", statementCount: 2 });
  });

  test.afterAll(async () => {
    await deleteTestRound(closedRound.roundId).catch(() => undefined);
    await deleteTestRound(emptyRound.roundId).catch(() => undefined);
    await revokeTestAdmin(adminEmail);
    await deleteAuthUserByEmail(adminEmail);
    await deleteAuthUserByEmail(paEmail);
    await deleteAuthUserByEmail(pbEmail);
    await deleteAuthUserByEmail(pcEmail);
    await deleteAuthUserByEmail(guardEmail);
    expect(await countAuthUsersByEmail(adminEmail)).toBe(0);
    expect(await countAuthUsersByEmail(paEmail)).toBe(0);
    expect(await countAuthUsersByEmail(pbEmail)).toBe(0);
    expect(await countAuthUsersByEmail(pcEmail)).toBe(0);
    expect(await countAuthUsersByEmail(guardEmail)).toBe(0);
  });

  test("list and expand", async ({ page, context }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${closedRound.roundId}`);
    await page.getByRole("link", { name: ADMIN_MESSAGES.viewResponses }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: ADMIN_MESSAGES.responsesHeading })
    ).toBeVisible();
    await expect(page.getByText("3 responses", { exact: true })).toBeVisible();

    const rows = page.locator('[data-slot="table-body"] > tr[data-slot="table-row"]');

    const paRow = page.locator('tr[data-slot="table-row"]', { hasText: paEmail });
    await expect(paRow.getByText(ADMIN_MESSAGES.badgeSubmitted, { exact: true })).toBeVisible();
    await expect(paRow.getByText("2 of 2 answered", { exact: true })).toBeVisible();

    const pbRow = page.locator('tr[data-slot="table-row"]', { hasText: pbEmail });
    await expect(pbRow.getByText(ADMIN_MESSAGES.badgeStarted, { exact: true })).toBeVisible();
    await expect(pbRow.getByText("—", { exact: true })).toBeVisible();
    await expect(pbRow.getByText("1 of 2 answered", { exact: true })).toBeVisible();

    const pcRow = page.locator('tr[data-slot="table-row"]', { hasText: pcEmail });
    await expect(pcRow.getByText(ADMIN_MESSAGES.badgeStarted, { exact: true })).toBeVisible();
    await expect(pcRow.getByText("0 of 2 answered", { exact: true })).toBeVisible();

    // Rows render in email order: pa, pb, pc.
    const rowCount = await rows.count();
    expect(rowCount).toBe(3);
    await expect(rows.nth(0)).toContainText(paEmail);
    await expect(rows.nth(1)).toContainText(pbEmail);
    await expect(rows.nth(2)).toContainText(pcEmail);

    // Each email cell carries a title attribute equal to the full email.
    await expect(paRow.locator("td", { hasText: paEmail }).first()).toHaveAttribute(
      "title",
      paEmail
    );

    // Expanding pa shows both answers with their agreement labels, numbered
    // 1..N, with no statement key text anywhere in the panel.
    const paToggle = paRow.locator("button[aria-controls]");
    await paToggle.click();
    await expect(paToggle).toHaveAttribute("aria-expanded", "true");
    await expect(paToggle).toHaveText(ADMIN_MESSAGES.hideAnswers);
    const paPanel = page.locator(`#${await paToggle.getAttribute("aria-controls")}`);
    await expect(paPanel.getByText("1.", { exact: false }).first()).toBeVisible();
    await expect(paPanel.getByText("2.", { exact: false }).first()).toBeVisible();
    await expect(paPanel.getByText("Strongly disagree", { exact: true })).toBeVisible();
    await expect(paPanel.getByText("Disagree", { exact: true })).toBeVisible();
    await expect(paPanel.getByText("e2e_01", { exact: true })).toHaveCount(0);
    await expect(paPanel.getByText("e2e_02", { exact: true })).toHaveCount(0);

    // Expanding pc (zero answers) shows "Not answered" for every statement.
    const pcToggle = pcRow.locator("button[aria-controls]");
    await pcToggle.click();
    await expect(pcToggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText(ADMIN_MESSAGES.notAnswered, { exact: false })
    ).toHaveCount(2);

    // Filtering "rb" leaves exactly pb's row.
    await page.getByLabel(ADMIN_MESSAGES.filterByEmail).fill("rb");
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText(pbEmail);
  });

  test("empty", async ({ page, context }) => {
    await signInViaCodePage(page, context, adminEmail);
    await page.goto(`/admin/rounds/${emptyRound.roundId}/responses`);

    await expect(
      page.getByText(ADMIN_MESSAGES.noResponsesHeading, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(ADMIN_MESSAGES.noResponsesBody, { exact: true })
    ).toBeVisible();
  });

  test("export route: content, headers, download, and the empty-round header-only body", async ({
    page,
    context,
  }) => {
    await signInViaCodePage(page, context, adminEmail);

    // Build the exact expected body from the live DB rows (via the same
    // admin_round_responses RPC + pivot/csv helpers this route uses), so
    // this assertion never hard-codes a timestamp the DB itself stamped.
    const adminApiClient = await signInAsTestUser(adminEmail);
    const { data: rpcRows, error: rpcError } = await adminApiClient.rpc(
      "admin_round_responses",
      { p_round_id: closedRound.roundId }
    );
    expect(rpcError).toBeNull();
    const participants = pivotResponses((rpcRows ?? []) as AdminResponseRow[]);
    const expectedBody = toRoundCsv(participants, ["e2e_01", "e2e_02"]);

    const response = await page.request.get(
      `/admin/rounds/${closedRound.roundId}/export`
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="round-${closedRound.roundNumber}-responses.csv"`
    );
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.text();
    expect(body).toBe(expectedBody);
    // pb's e2e_02 cell and pc's answer cells are empty.
    expect(body).toContain(`${pbEmail},`);
    const pbLine = body
      .split("\r\n")
      .find((line) => line.startsWith(pbEmail))!;
    expect(pbLine.endsWith(",3,")).toBe(true);
    const pcLine = body
      .split("\r\n")
      .find((line) => line.startsWith(pcEmail))!;
    expect(pcLine.endsWith(",,")).toBe(true);

    // Clicking "Export CSV" emits a download with the expected filename.
    await page.goto(`/admin/rounds/${closedRound.roundId}/responses`);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: ADMIN_MESSAGES.exportCsv }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `round-${closedRound.roundNumber}-responses.csv`
    );

    // The empty round's export is a valid, header-only file.
    const emptyResponse = await page.request.get(
      `/admin/rounds/${emptyRound.roundId}/export`
    );
    expect(emptyResponse.status()).toBe(200);
    expect(await emptyResponse.text()).toBe(
      "email,started_at,submitted_at,e2e_01,e2e_02\r\n"
    );
  });

  test("export route guard: non-admin 404s, signed-out redirects to /login, bad/unknown ids 404", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await signInViaCodePage(page, context, adminEmail);

    // A signed-in participant's own context gets 404 from the export
    // route, and the responses page itself bounces to / (admin-only).
    const participantContext = await browser.newContext();
    const participantPage = await participantContext.newPage();
    await signInViaCodePage(participantPage, participantContext, guardEmail);

    const participantExportResponse = await participantPage.request.get(
      `/admin/rounds/${closedRound.roundId}/export`
    );
    expect(participantExportResponse.status()).toBe(404);

    await participantPage.goto(
      `/admin/rounds/${closedRound.roundId}/responses`
    );
    await expect(participantPage).toHaveURL(`${baseURL}/`);
    await participantContext.close();

    // A signed-out request is redirected to /login (proxy.ts).
    const signedOutContext = await browser.newContext({ baseURL });
    const signedOutResponse = await signedOutContext.request.get(
      `/admin/rounds/${closedRound.roundId}/export`,
      { maxRedirects: 0 }
    );
    expect(signedOutResponse.status()).toBe(307);
    expect(signedOutResponse.headers()["location"]).toContain("/login");
    await signedOutContext.close();

    // The admin, on a malformed or unknown round id, gets 404.
    const malformed = await page.request.get(
      "/admin/rounds/not-a-uuid/export"
    );
    expect(malformed.status()).toBe(404);

    const unknown = await page.request.get(
      "/admin/rounds/00000000-0000-0000-0000-000000000000/export"
    );
    expect(unknown.status()).toBe(404);
  });
});
