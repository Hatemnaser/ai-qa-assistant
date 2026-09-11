import type {
  RecipeLocatorV1,
  RecipeStepV1,
} from "@oddpath/qa-execution-contract";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

import type { RunnerConfig, RunnerProfileConfig } from "./config.js";
import type { SemanticBrowserSession } from "./interpreter.js";

type Expectation = Extract<RecipeStepV1, { action: "expect" }>["expectation"];

export interface PlaywrightSessionFactoryOptions {
  browser: RunnerConfig["browser"]["engine"];
  headless: boolean;
}

export function createPlaywrightSessionFactory(options: PlaywrightSessionFactoryOptions) {
  return async (profile: RunnerProfileConfig): Promise<SemanticBrowserSession> => {
    const browser = await browserType(options.browser).launch({ headless: options.headless });
    try {
      const context = await browser.newContext({
        acceptDownloads: false,
        viewport: { height: 900, width: 1440 },
      });
      const page = await context.newPage();
      await blockCrossOriginTopLevelNavigation(context, page, profile.baseUrl);
      return new PlaywrightSemanticSession(browser, context, page);
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  };
}

class PlaywrightSemanticSession implements SemanticBrowserSession {
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page
  ) {}

  async check(locator: RecipeLocatorV1, checked: boolean, timeoutMs: number) {
    const target = this.locator(locator);
    if (checked) await target.check({ timeout: timeoutMs });
    else await target.uncheck({ timeout: timeoutMs });
  }

  async click(locator: RecipeLocatorV1, timeoutMs: number) {
    await this.locator(locator).click({ timeout: timeoutMs });
  }

  async close() {
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }

  currentUrl() {
    return this.page.url();
  }

  async expect(expectation: Expectation, timeoutMs: number) {
    switch (expectation.kind) {
      case "visible":
        await this.locator(expectation.locator).waitFor({ state: "visible", timeout: timeoutMs });
        return;
      case "hidden":
        await this.locator(expectation.locator).waitFor({ state: "hidden", timeout: timeoutMs });
        return;
      case "enabled":
        await waitForCondition(
          () => this.locator(expectation.locator).isEnabled(),
          timeoutMs
        );
        return;
      case "disabled":
        await waitForCondition(
          () => this.locator(expectation.locator).isDisabled(),
          timeoutMs
        );
        return;
      case "checked":
        await waitForCondition(
          () => this.locator(expectation.locator).isChecked(),
          timeoutMs
        );
        return;
      case "unchecked":
        await waitForCondition(
          async () => !(await this.locator(expectation.locator).isChecked()),
          timeoutMs
        );
        return;
      case "textEquals":
        await waitForCondition(async () => {
          const text = await this.locator(expectation.locator).textContent();
          return normalizeText(text) === normalizeText(expectation.expected);
        }, timeoutMs);
        return;
      case "textContains":
        await waitForCondition(async () => {
          const text = await this.locator(expectation.locator).textContent();
          return normalizeText(text).includes(normalizeText(expectation.expected));
        }, timeoutMs);
        return;
      case "valueEquals":
        await waitForCondition(
          async () => await this.locator(expectation.locator).inputValue() === expectation.expected,
          timeoutMs
        );
        return;
      case "countEquals":
        await waitForCondition(
          async () => await this.locator(expectation.locator).count() === expectation.expected,
          timeoutMs
        );
        return;
      case "urlPathEquals":
        await this.page.waitForURL(
          (url) => url.pathname === expectation.expected,
          { timeout: timeoutMs }
        );
        return;
      case "urlPathContains":
        await this.page.waitForURL(
          (url) => url.pathname.includes(expectation.expected),
          { timeout: timeoutMs }
        );
    }
  }

  async fill(locator: RecipeLocatorV1, value: string, timeoutMs: number) {
    await this.locator(locator).fill(value, { timeout: timeoutMs });
  }

  async hover(locator: RecipeLocatorV1, timeoutMs: number) {
    await this.locator(locator).hover({ timeout: timeoutMs });
  }

  async navigate(
    url: string,
    waitUntil: "domcontentloaded" | "load",
    timeoutMs: number
  ) {
    await this.page.goto(url, { timeout: timeoutMs, waitUntil });
  }

  async press(
    locator: RecipeLocatorV1,
    key: Extract<RecipeStepV1, { action: "press" }>["key"],
    timeoutMs: number
  ) {
    await this.locator(locator).press(key, { timeout: timeoutMs });
  }

  async screenshot() {
    return this.page.screenshot({ animations: "disabled", fullPage: false, type: "png" });
  }

  async select(
    locator: RecipeLocatorV1,
    option: "label" | "value",
    value: string,
    timeoutMs: number
  ) {
    await this.locator(locator).selectOption(
      option === "label" ? { label: value } : { value },
      { timeout: timeoutMs }
    );
  }

  private locator(input: RecipeLocatorV1): Locator {
    let locator: Locator;
    switch (input.by) {
      case "role":
        locator = this.page.getByRole(input.role, { exact: input.exact, name: input.name });
        break;
      case "label":
        locator = this.page.getByLabel(input.value, { exact: input.exact });
        break;
      case "placeholder":
        locator = this.page.getByPlaceholder(input.value, { exact: input.exact });
        break;
      case "text":
        locator = this.page.getByText(input.value, { exact: input.exact });
        break;
      case "testId":
        locator = this.page.getByTestId(input.value);
        break;
    }
    return input.index === undefined ? locator : locator.nth(input.index);
  }
}

async function blockCrossOriginTopLevelNavigation(
  context: BrowserContext,
  page: Page,
  baseUrl: string
) {
  const allowedOrigin = new URL(baseUrl).origin;
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      let target: URL;
      try {
        target = new URL(request.url());
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      if (target.origin !== allowedOrigin) {
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
  });
}

function browserType(engine: RunnerConfig["browser"]["engine"]) {
  switch (engine) {
    case "chromium": return chromium;
    case "firefox": return firefox;
    case "webkit": return webkit;
  }
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);

  if (lastError instanceof Error) throw lastError;
  throw new Error("The declared page expectation did not become true before its timeout.");
}

function normalizeText(value: string | null) {
  return (value || "").replace(/\s+/gu, " ").trim();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
