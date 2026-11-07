import { expect, test } from "@playwright/test";

test("OpenAI-compatible provider exposes a custom endpoint, key, and model", async ({ page }) => {
  await page.goto("/run");

  await page.getByLabel("Chat provider").selectOption("oneapi");
  await expect(page.getByLabel("Transport mode").locator('option[value="demo"]')).toBeDisabled();
  await expect(page.getByLabel("Transport mode")).toHaveValue("proxy");
  await expect(page.getByLabel("Model id", { exact: true })).toHaveValue("gpt-4o-mini");

  await page.getByLabel("Transport mode").selectOption("direct");
  await expect(page.getByLabel("Provider base URL")).toHaveValue("https://oneapi.example.com/v1");
  await expect(page.getByLabel("Provider API key")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("Image model id")).toHaveValue("dall-e-3");

  await page.getByLabel("Provider base URL").fill("https://relay.example/v1");
  await page.getByLabel("Model id", { exact: true }).fill("relay-model");
  await expect(page.getByLabel("Provider base URL")).toHaveValue("https://relay.example/v1");
  await expect(page.getByLabel("Model id", { exact: true })).toHaveValue("relay-model");
  await expect(page.getByLabel("Run mode").locator('option[value="background"]')).toBeDisabled();
});
