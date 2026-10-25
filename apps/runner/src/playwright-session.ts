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
import { BrowserSessionUnavailableError, type SemanticBrowserSession } from "./interpreter.js";

export async function createManagedPlaywrightSession(endpoint: string, token: string, baseUrl: string): Promise<SemanticBrowserSession> {
  // CDP stays on the private allocation network. The token grants control of
  // this runtime only and is never sent to page requests.
  const response = await fetch(`${endpoint}/cdp/json/version`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error("Managed Chrome is unavailable.");
  const data = await response.json() as { webSocketDebuggerUrl?: string };
  const debuggerPath = new URL(data.webSocketDebuggerUrl || "").pathname;
  if (!debuggerPath.startsWith('/devtools/browser/')) throw new Error("Invalid managed CDP endpoint.");
  const browser = await chromium.connectOverCDP(`${endpoint.replace(/^http/u, 'ws')}/cdp${debuggerPath}`, { headers: { authorization: `Bearer ${token}` }, timeout: 5_000 });
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Managed browser context is missing.");
    const page = context.pages()[0] || await context.newPage();
    const session = new PlaywrightSemanticSession(browser, context, page, true);
    await context.clearPermissions();
    const control = await browser.newBrowserCDPSession();
    await control.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    context.on('page', popup => { if (popup !== page) void popup.close(); });
    await blockCrossOriginTopLevelNavigation(context, page, baseUrl);
    session.assertHealthy();
    return session;
  } catch (error) { await browser.close(); throw error; }
}

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
  private unavailable = false;
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly managed = false
  ) {
    if (managed) {
      const unavailable = () => { this.unavailable = true; };
      page.on('crash', unavailable);
      page.on('close', unavailable);
      context.on('close', unavailable);
      browser.on('disconnected', unavailable);
    }
  }

  assertHealthy() {
    if (this.managed && (this.unavailable || this.page.isClosed() || !this.browser.isConnected())) throw new BrowserSessionUnavailableError();
  }

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
    const wait = (predicate: () => Promise<boolean>) => waitForCondition(predicate, timeoutMs, () => this.assertHealthy());
    switch (expectation.kind) {
      case "visible":
        await this.locator(expectation.locator).waitFor({ state: "visible", timeout: timeoutMs });
        return;
      case "hidden":
        await this.locator(expectation.locator).waitFor({ state: "hidden", timeout: timeoutMs });
        return;
      case "enabled":
        await wait(() => this.locator(expectation.locator).isEnabled());
        return;
      case "disabled":
        await wait(() => this.locator(expectation.locator).isDisabled());
        return;
      case "checked":
        await wait(() => this.locator(expectation.locator).isChecked());
        return;
      case "unchecked":
        await wait(async () => !(await this.locator(expectation.locator).isChecked()));
        return;
      case "textEquals":
        await wait(async () => {
          const text = await this.locator(expectation.locator).textContent();
          return normalizeText(text) === normalizeText(expectation.expected);
        });
        return;
      case "textContains":
        await wait(async () => {
          const text = await this.locator(expectation.locator).textContent();
          return normalizeText(text).includes(normalizeText(expectation.expected));
        });
        return;
      case "valueEquals":
        await wait(async () => await this.locator(expectation.locator).inputValue() === expectation.expected);
        return;
      case "countEquals":
        await wait(async () => await this.locator(expectation.locator).count() === expectation.expected);
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
  timeoutMs: number,
  assertHealthy: () => void
) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  do {
    assertHealthy();
    try {
      if (await predicate()) return;
    } catch (error) {
      assertHealthy();
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
