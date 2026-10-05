import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

export interface BrowserNetworkLog {
  url: string;
  method: string;
  status?: number;
}

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private pages: Page[] = [];
  private consoleLogs: string[] = [];
  private networkLogs: BrowserNetworkLog[] = [];

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  public validateUrl(url: string, workspaceDir: string): string {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      throw new Error("URL cannot be empty.");
    }

    if (trimmed.startsWith("file://")) {
      let resolvedTarget: string;
      try {
        resolvedTarget = path.resolve(fileURLToPath(trimmed));
      } catch {
        const filePath = trimmed.replace(/^file:\/\/\/?/, "");
        resolvedTarget = path.resolve(filePath);
      }
      const resolvedWorkspace = path.resolve(workspaceDir);

      if (!resolvedTarget.startsWith(resolvedWorkspace)) {
        throw new Error(
          `Security violation: Browser cannot access local file outside workspace: '${trimmed}'.`,
        );
      }
      return trimmed;
    }

    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("data:")) {
      return `https://${trimmed}`;
    }

    return trimmed;
  }

  private async ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
    if (!this.browser || !this.browser.isConnected()) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
      } catch {
        // Fallback to system chrome channel if bundled headless shell needs fallback
        this.browser = await chromium.launch({
          headless: true,
          channel: "chrome",
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
      }

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "OrbaAgent-PlaywrightBot/1.0",
      });

      this.pages = [];
      this.consoleLogs = [];
      this.networkLogs = [];
    }

    if (!this.activePage || this.activePage.isClosed()) {
      this.activePage = await this.context!.newPage();
      this.pages.push(this.activePage);
      this.setupPageListeners(this.activePage);
    }

    return { browser: this.browser, page: this.activePage };
  }

  private setupPageListeners(page: Page): void {
    const secretManager = SecretManager.getInstance();

    page.on("console", (msg) => {
      const redacted = secretManager.redact(`[${msg.type()}] ${msg.text()}`);
      this.consoleLogs.push(redacted);
      if (this.consoleLogs.length > 200) this.consoleLogs.shift();
    });

    page.on("response", (res) => {
      const redactedUrl = secretManager.redact(res.url());
      this.networkLogs.push({
        url: redactedUrl,
        method: res.request().method(),
        status: res.status(),
      });
      if (this.networkLogs.length > 200) this.networkLogs.shift();
    });
  }

  public async navigate(url: string, workspaceDir: string): Promise<{ title: string; url: string; status: number }> {
    const safeUrl = this.validateUrl(url, workspaceDir);
    const { page } = await this.ensureBrowser();

    const response = await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    const title = await page.title();
    return {
      title,
      url: page.url(),
      status: response ? response.status() : 200,
    };
  }

  public async snapshot(selector?: string): Promise<{ title: string; url: string; content: string }> {
    const { page } = await this.ensureBrowser();
    const title = await page.title();
    const url = page.url();

    let content = "";
    if (selector) {
      const el = await page.$(selector);
      content = el ? (await el.innerText()) : `Element not found for selector '${selector}'`;
    } else {
      content = await page.evaluate(() => {
        return document.body ? document.body.innerText.slice(0, 8000) : "";
      });
    }

    return { title, url, content };
  }

  public async click(selector: string): Promise<void> {
    const { page } = await this.ensureBrowser();
    await page.click(selector, { timeout: 10000 });
  }

  public async fill(selector: string, value: string): Promise<void> {
    const { page } = await this.ensureBrowser();
    await page.fill(selector, value, { timeout: 10000 });
  }

  public async type(selector: string, text: string): Promise<void> {
    const { page } = await this.ensureBrowser();
    await page.focus(selector);
    const loc = page.locator(selector);
    if (typeof (loc as any).pressSequentially === "function") {
      await loc.pressSequentially(text, { timeout: 10000 });
    } else {
      await page.type(selector, text, { timeout: 10000 });
    }
  }

  public async select(selector: string, value: string): Promise<void> {
    const { page } = await this.ensureBrowser();
    await page.selectOption(selector, value, { timeout: 10000 });
  }

  public async upload(selector: string, filePath: string, workspaceDir: string): Promise<void> {
    const resolved = path.resolve(workspaceDir, filePath);
    if (!resolved.startsWith(path.resolve(workspaceDir))) {
      throw new Error(`Upload denied: file '${filePath}' is outside workspace scope.`);
    }
    const { page } = await this.ensureBrowser();
    await page.setInputFiles(selector, resolved);
  }

  public async screenshot(fullPage = false): Promise<string> {
    const { page } = await this.ensureBrowser();
    const buffer = await page.screenshot({ fullPage, type: "png" });
    return buffer.toString("base64");
  }

  public async back(): Promise<string> {
    const { page } = await this.ensureBrowser();
    await page.goBack({ timeout: 10000 });
    return page.url();
  }

  public async forward(): Promise<string> {
    const { page } = await this.ensureBrowser();
    await page.goForward({ timeout: 10000 });
    return page.url();
  }

  public async reload(): Promise<string> {
    const { page } = await this.ensureBrowser();
    await page.reload({ timeout: 10000 });
    return page.url();
  }

  public async newTab(): Promise<number> {
    const { browser } = await this.ensureBrowser();
    const newPage = await this.context!.newPage();
    this.pages.push(newPage);
    this.activePage = newPage;
    this.setupPageListeners(newPage);
    return this.pages.length - 1;
  }

  public async closeTab(): Promise<void> {
    if (this.activePage) {
      await this.activePage.close();
      this.pages = this.pages.filter((p) => p !== this.activePage);
      this.activePage = this.pages.length > 0 ? this.pages[this.pages.length - 1] : null;
    }
  }

  public getConsoleLogs(): string[] {
    return [...this.consoleLogs];
  }

  public getNetworkLogs(): BrowserNetworkLog[] {
    return [...this.networkLogs];
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.activePage = null;
      this.pages = [];
    }
  }
}

export class BrowserTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "browser_action",
    description:
      "Execute automated browser actions using Playwright (navigate, snapshot, click, fill, type, select, upload, screenshot, back, forward, reload, new_tab, close_tab, console, network). Operates on real web applications.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "navigate",
            "open",
            "snapshot",
            "click",
            "fill",
            "type",
            "select",
            "upload",
            "screenshot",
            "back",
            "forward",
            "reload",
            "new_tab",
            "close_tab",
            "console",
            "network",
            "close",
          ],
          description: "Browser command action to perform.",
        },
        url: {
          type: "string",
          description: "URL to navigate to (for 'navigate' / 'open').",
        },
        selector: {
          type: "string",
          description: "CSS or text selector for the target element.",
        },
        value: {
          type: "string",
          description: "Input text or select value (for 'fill', 'type', 'select').",
        },
        filePath: {
          type: "string",
          description: "Relative workspace file path for 'upload'.",
        },
        fullPage: {
          type: "boolean",
          description: "Capture full page screenshot (for 'screenshot', default false).",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "browser_action",
    description: "Automate real web browser interactions using headless Playwright",
    category: "browser",
    provider: "native",
    riskTier: "TIER_3_EXTERNAL",
    keywords: [
      "browser",
      "playwright",
      "web",
      "navigate",
      "click",
      "fill",
      "form",
      "snapshot",
      "screenshot",
      "scrape",
      "dom",
      "automation",
    ],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || "call_browser");
    const action = String(args.action || "snapshot").toLowerCase().trim();
    const browserManager = BrowserManager.getInstance();
    const secretManager = SecretManager.getInstance();

    try {
      switch (action) {
        case "open":
        case "navigate": {
          const url = String(args.url || "");
          const res = await browserManager.navigate(url, context.workspaceDir);
          const output = `Navigated to '${res.url}' (HTTP ${res.status}). Page Title: '${res.title}'`;
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: secretManager.redact(output),
            metadata: res,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "snapshot": {
          const selector = args.selector ? String(args.selector) : undefined;
          const snap = await browserManager.snapshot(selector);
          const output = `Page: ${snap.title} (${snap.url})\n\nContent:\n${snap.content.slice(0, 4000)}`;
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: secretManager.redact(output),
            metadata: { title: snap.title, url: snap.url },
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "click": {
          const selector = String(args.selector || "");
          if (!selector) throw new Error("Selector is required for 'click'.");
          await browserManager.click(selector);
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Clicked element '${selector}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "fill": {
          const selector = String(args.selector || "");
          const value = String(args.value || "");
          if (!selector) throw new Error("Selector is required for 'fill'.");
          await browserManager.fill(selector, value);
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Filled '${selector}' with value.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "type": {
          const selector = String(args.selector || "");
          const value = String(args.value || "");
          if (!selector) throw new Error("Selector is required for 'type'.");
          await browserManager.type(selector, value);
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Typed text into '${selector}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "select": {
          const selector = String(args.selector || "");
          const value = String(args.value || "");
          if (!selector) throw new Error("Selector is required for 'select'.");
          await browserManager.select(selector, value);
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Selected option '${value}' in '${selector}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "upload": {
          const selector = String(args.selector || "");
          const filePath = String(args.filePath || "");
          if (!selector || !filePath) throw new Error("Selector and filePath are required for 'upload'.");
          await browserManager.upload(selector, filePath, context.workspaceDir);
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Uploaded file '${filePath}' to '${selector}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "screenshot": {
          const fullPage = Boolean(args.fullPage);
          const base64 = await browserManager.screenshot(fullPage);
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Captured screenshot (Base64 length: ${base64.length} chars).`,
            metadata: { base64Length: base64.length, fullPage },
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "back": {
          const currentUrl = await browserManager.back();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Navigated back to '${currentUrl}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "forward": {
          const currentUrl = await browserManager.forward();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Navigated forward to '${currentUrl}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "reload": {
          const currentUrl = await browserManager.reload();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Reloaded page '${currentUrl}'.`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "new_tab": {
          const tabIndex = await browserManager.newTab();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: `Opened new tab (index ${tabIndex}).`,
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "close_tab": {
          await browserManager.closeTab();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: "Closed active tab.",
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "console": {
          const logs = browserManager.getConsoleLogs();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: logs.length > 0 ? logs.join("\n") : "(no console logs captured)",
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "network": {
          const logs = browserManager.getNetworkLogs();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output:
              logs.length > 0
                ? logs.map((l) => `${l.method} ${l.url} -> ${l.status || "pending"}`).join("\n")
                : "(no network logs captured)",
            executionTimeMs: Date.now() - startTime,
          };
        }
        case "close": {
          await browserManager.close();
          return {
            toolCallId,
            name: this.definition.name,
            success: true,
            output: "Closed browser session.",
            executionTimeMs: Date.now() - startTime,
          };
        }
        default:
          return {
            toolCallId,
            name: this.definition.name,
            success: false,
            output: "",
            error: `Unsupported browser action: '${action}'`,
            executionTimeMs: Date.now() - startTime,
          };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        name: this.definition.name,
        success: false,
        output: "",
        error: secretManager.redact(msg),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
