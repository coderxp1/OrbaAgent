import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BrowserManager,
  BrowserTool,
  CodeQualityTool,
  MCPProvider,
  PackageManagerTool,
  PermissionEngine,
  SecretManager,
  TestRunnerTool,
  ToolRegistry,
  ToolRouter,
  type ToolsSearchTool,
} from "./index.js";

describe("Phase 3A: Advanced Tools, MCP Provider, and Execution Engine", () => {
  let tempWorkspace: string;
  let registry: ToolRegistry;
  let router: ToolRouter;
  let permissionEngine: PermissionEngine;
  let secretManager: SecretManager;
  let mcpProvider: MCPProvider;
  let mcpServerScriptPath: string;

  beforeAll(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "orbaagent-phase3a-test-"));
    secretManager = SecretManager.getInstance();
    permissionEngine = PermissionEngine.getInstance();
    registry = new ToolRegistry();
    router = new ToolRouter({ registry, permissionEngine, secretManager });
    mcpProvider = new MCPProvider();

    // 1. Create a local test HTML file for real Playwright testing
    const testHtml = `<!DOCTYPE html>
<html>
<head><title>OrbaAgent Playwright Test</title></head>
<body>
  <h1 id="header">Playwright Live Test</h1>
  <p id="status">Initial Status</p>
  <input id="test-input" type="text" placeholder="Type here..." />
  <button id="test-button" onclick="document.getElementById('status').innerText = 'Clicked: ' + document.getElementById('test-input').value">Submit</button>
</body>
</html>`;
    await fs.writeFile(path.join(tempWorkspace, "index.html"), testHtml, "utf-8");

    // 2. Create a real lightweight MCP Stdio JSON-RPC 2.0 test server script
    mcpServerScriptPath = path.join(tempWorkspace, "mcp_test_server.mjs");
    const mcpServerCode = `import * as readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-mcp-server', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (msg.method === 'notifications/initialized') {
      // No response needed for notification
    } else if (msg.method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            {
              name: 'echo_service',
              description: 'Echo back input message with server timestamp',
              inputSchema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message']
              }
            },
            {
              name: 'compute_sum',
              description: 'Add two numbers together',
              inputSchema: {
                type: 'object',
                properties: { a: { type: 'number' }, b: { type: 'number' } },
                required: ['a', 'b']
              }
            }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (msg.method === 'tools/call') {
      const toolName = msg.params?.name;
      const args = msg.params?.arguments || {};
      let resultText = '';
      if (toolName === 'echo_service') {
        resultText = 'ECHO_RESPONSE: ' + (args.message || '');
      } else if (toolName === 'compute_sum') {
        resultText = 'SUM: ' + ((args.a || 0) + (args.b || 0));
      } else {
        resultText = 'UNKNOWN_TOOL';
      }
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: resultText }],
          isError: false
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    }
  } catch (err) {
    // ignore
  }
});
`;
    await fs.writeFile(mcpServerScriptPath, mcpServerCode, "utf-8");
  });

  afterAll(async () => {
    await mcpProvider.disconnectAll().catch(() => {});
    await BrowserManager.getInstance()
      .close()
      .catch(() => {});
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. Real Playwright Browser Execution & Safety", () => {
    it("executes real navigation, snapshot, type, click, and screenshot on local HTML page", async () => {
      const browserTool = new BrowserTool();
      const localUrl = pathToFileURL(path.join(tempWorkspace, "index.html")).href;
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      // 1. Navigate
      const navRes = await browserTool.execute({ action: "navigate", url: localUrl }, context);
      expect(navRes.success).toBe(true);
      expect(navRes.output).toContain("OrbaAgent Playwright Test");

      // 2. Snapshot
      const snapRes = await browserTool.execute({ action: "snapshot" }, context);
      expect(snapRes.success).toBe(true);
      expect(snapRes.output).toContain("Playwright Live Test");
      expect(snapRes.output).toContain("Initial Status");

      // 3. Fill input
      const fillRes = await browserTool.execute(
        { action: "fill", selector: "#test-input", value: "Autonomous Agent Verified" },
        context,
      );
      expect(fillRes.success).toBe(true);

      // 4. Click button to trigger DOM change
      const clickRes = await browserTool.execute(
        { action: "click", selector: "#test-button" },
        context,
      );
      expect(clickRes.success).toBe(true);

      // 5. Snapshot after click to verify DOM update
      const snapAfterRes = await browserTool.execute({ action: "snapshot" }, context);
      expect(snapAfterRes.success).toBe(true);
      expect(snapAfterRes.output).toContain("Clicked: Autonomous Agent Verified");

      // 6. Screenshot
      const shotRes = await browserTool.execute({ action: "screenshot" }, context);
      expect(shotRes.success).toBe(true);
      expect(shotRes.output).toContain("Captured screenshot");
      expect((shotRes.metadata as any)?.base64Length).toBeGreaterThan(100);

      // 7. Close browser context
      const closeRes = await browserTool.execute({ action: "close" }, context);
      expect(closeRes.success).toBe(true);
    }, 30000);

    it("BLOCKS browser file access outside workspace boundaries", async () => {
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const outsideFileUrl =
        process.platform === "win32"
          ? "file:///C:/Windows/System32/drivers/etc/hosts"
          : "file:///etc/passwd";

      const { result, auditEvent } = await router.routeAndExecute(
        "call_browser_outside",
        "browser_action",
        { action: "navigate", url: outsideFileUrl },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission Denied");
      expect(result.error).toContain("outside workspace scope");
      expect(auditEvent?.approved).toBe(false);
    });

    it("BLOCKS file upload from outside workspace boundaries", async () => {
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const { result, auditEvent } = await router.routeAndExecute(
        "call_browser_bad_upload",
        "browser_action",
        { action: "upload", selector: "#file-input", filePath: "../../sensitive.key" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the allowed workspace boundaries");
      expect(auditEvent?.approved).toBe(false);
    });
  });

  describe("2. Real MCP Provider & Protocol Verification", () => {
    it("connects to real stdio MCP server, negotiates JSON-RPC handshake, and lists tools", async () => {
      const tools = await mcpProvider.registerServer({
        name: "testserver",
        command: process.execPath,
        args: [mcpServerScriptPath],
        cwd: tempWorkspace,
      });

      expect(tools.length).toBe(2);
      const names = tools.map((t) => t.definition.name);
      expect(names).toContain("mcp_testserver_echo_service");
      expect(names).toContain("mcp_testserver_compute_sum");

      // Register the MCP tools into the central ToolRegistry
      for (const t of tools) {
        registry.registerTool(t);
      }
    });

    it("routes and executes MCP tool call through ToolRouter with full audit trail", async () => {
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const { result, auditEvent } = await router.routeAndExecute(
        "call_mcp_calc",
        "mcp_testserver_compute_sum",
        { a: 40, b: 2 },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("SUM: 42");
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.approved).toBe(true);
      expect(auditEvent?.toolName).toBe("mcp_testserver_compute_sum");
      expect(auditEvent?.category).toBe("mcp");
    });

    it("enforces SecretManager redaction on sensitive tokens in MCP outputs", async () => {
      secretManager.registerSecret("sk-mcp-isolated-secret-777", "MCP_API_TOKEN");

      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const { result } = await router.routeAndExecute(
        "call_mcp_secret",
        "mcp_testserver_echo_service",
        { message: "Bearer sk-mcp-isolated-secret-777 for auth" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.output).not.toContain("sk-mcp-isolated-secret-777");
      expect(result.output).toContain("***REDACTED***");
    });
  });

  describe("3. Package Management & Safety Policies", () => {
    it("retrieves package information for dependencies", async () => {
      const pkgTool = new PackageManagerTool();
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const result = await pkgTool.execute(
        { action: "info", packageName: "zod", packageManager: "npm" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.output.toLowerCase()).toContain("zod");
    }, 25000);

    it("strictly BLOCKS global install flags (-g / --global)", async () => {
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
        isPreApproved: true,
      };

      const { result, auditEvent } = await router.routeAndExecute(
        "call_pkg_global",
        "package_manager",
        { action: "install", packageName: "typescript", extraArgs: "-g" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Global package installation ('-g' / '--global') is strictly prohibited",
      );
      expect(auditEvent?.approved).toBe(false);
    });

    it("BLOCKS package install without explicit approval (TIER_3_EXTERNAL)", async () => {
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
        isPreApproved: false, // NOT PRE-APPROVED
      };

      const { result, auditEvent } = await router.routeAndExecute(
        "call_pkg_unapproved",
        "package_manager",
        { action: "install", packageName: "chalk" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("requires explicit user approval");
      expect(auditEvent?.approved).toBe(false);
    });
  });

  describe("4. Structured Test Runner", () => {
    it("discovers test frameworks in workspace", async () => {
      const testRunner = new TestRunnerTool();
      const monorepoRoot = path.resolve(__dirname, "../../..");
      const context = {
        workspaceDir: monorepoRoot,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const result = await testRunner.execute({ action: "discover" }, context);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.framework).toBe("vitest");
    });

    it("executes a specific test file and parses structured test metrics", async () => {
      const testRunner = new TestRunnerTool();
      const monorepoRoot = path.resolve(__dirname, "../../..");
      const context = {
        workspaceDir: monorepoRoot,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const result = await testRunner.execute(
        { action: "run_file", file: "packages/shared/src/index.test.ts" },
        context,
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.framework).toBe("vitest");
      expect(parsed.passed).toBeGreaterThanOrEqual(6);
      expect(parsed.failed).toBe(0);
      expect(parsed.exitCode).toBe(0);
    }, 30000);

    it("BLOCKS executing test files outside workspace", async () => {
      const monorepoRoot = path.resolve(__dirname, "../../..");
      const context = {
        workspaceDir: monorepoRoot,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const { result, auditEvent } = await router.routeAndExecute(
        "call_test_outside",
        "test_runner",
        { action: "run_file", file: "../../external_test.ts" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the allowed workspace boundary");
      expect(auditEvent?.approved).toBe(false);
    });
  });

  describe("5. Structured Lint / Typecheck Engine", () => {
    it("detects available code quality tools in repository", async () => {
      const codeQualityTool = new CodeQualityTool();
      const monorepoRoot = path.resolve(__dirname, "../../..");
      const context = {
        workspaceDir: monorepoRoot,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const result = await codeQualityTool.execute({ action: "detect" }, context);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.linters.length).toBeGreaterThan(0);
      expect(parsed.typecheckers).toContain("tsc");
    });

    it("BLOCKS lint execution targeting files outside workspace", async () => {
      const monorepoRoot = path.resolve(__dirname, "../../..");
      const context = {
        workspaceDir: monorepoRoot,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const { result, auditEvent } = await router.routeAndExecute(
        "call_lint_outside",
        "code_quality",
        { action: "lint", targetPath: "../../external_code" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside the allowed workspace boundaries");
      expect(auditEvent?.approved).toBe(false);
    });
  });

  describe("6. Autonomous Discovery & Multi-Step Execution Loop", () => {
    it("autonomously searches for browser capabilities, activates tool, and executes action", async () => {
      // 1. Reset registry to bare minimum core tools
      registry.resetActiveToolsToCore();
      expect(registry.getActiveToolNames()).toEqual([
        "task_plan",
        "task_step",
        "tools_search",
        "environment_inspect",
        "capabilities_inspect",
        "task_complete",
      ]);

      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      // 2. Autonomous Agent Step 1: Search for web automation tools
      const searchTool = registry.getTool("tools_search") as ToolsSearchTool;
      const searchRes = await searchTool.execute(
        { query: "browser playwright web navigate snapshot", limit: 5 },
        context,
      );

      expect(searchRes.success).toBe(true);
      expect(searchRes.output).toContain("browser_action");

      // 3. Verify registry dynamically activated browser_action
      expect(registry.getActiveToolNames()).toContain("browser_action");

      // 4. Autonomous Agent Step 2: Execute the dynamically activated tool
      const localUrl = pathToFileURL(path.join(tempWorkspace, "index.html")).href;
      const { result: navResult } = await router.routeAndExecute(
        "call_auto_nav",
        "browser_action",
        { action: "navigate", url: localUrl },
        context,
      );

      expect(navResult.success).toBe(true);
      expect(navResult.output).toContain("OrbaAgent Playwright Test");

      // 5. Autonomous Agent Step 3: Complete task
      const { result: completeResult } = await router.routeAndExecute(
        "call_complete",
        "task_complete",
        { summary: "Navigated to page and verified contents successfully." },
        context,
      );

      expect(completeResult.success).toBe(true);
    });
  });
});
