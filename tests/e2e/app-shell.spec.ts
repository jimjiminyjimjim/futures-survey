import { test, expect } from "@playwright/test";

test("signed-out visitor to / is redirected to /login @app-shell", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("prefix-adjacent /loginx redirects to /login @app-shell", async ({
  page,
}) => {
  await page.goto("/loginx");
  await expect(page).toHaveURL(/\/login$/);
});

test("/login stays on /login for a signed-out visitor @app-shell", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login$/);
});
