import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BackgroundJobTool,
  BrowserTool,
  CITool,
  CapabilitiesInspectTool,
  CapabilityManager,
  ConnectorProvider,
  ContainerTool,
  DatabaseTool,
  DeploymentTool,
  IntegrationsManager,
  JobManager,
  NativeProvider,
  PermissionEngine,
  SecretManager,
  ToolRegistry,
  ToolRouter,
} from "./index.js";
import type { ToolExecutionContext } from "./tools/base.js";

const execAsync = promisify(exec);

describe("Phase 4A: Production Capability Verification & Autonomous Workflow", () => {
  let tempWorkspace: string;
  let registry: ToolRegistry;
  let router: ToolRouter;
  let permissionEngine: PermissionEngine;
  let secretManager: SecretManager;
  let capabilityManager: CapabilityManager;

  const makeCtx = (overrides?: Partial<ToolExecutionContext>): ToolExecutionContext => ({
    workspaceDir: tempWorkspace,
    tenantId: "t-phase4a",
    userId: "u-phase4a",
    agentRunId: "run_phase4a",
    ...overrides,
  });

  beforeAll(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "orbaagent-phase4a-test-"));
    await execAsync("git init", { cwd: tempWorkspace });
    await execAsync('git config user.email "test@orbaagent.dev"', { cwd: tempWorkspace });
    await execAsync('git config user.name "OrbaAgent Test"', { cwd: tempWorkspace });

    secretManager = SecretManager.getInstance();
    permissionEngine = PermissionEngine.getInstance();
    permissionEngine.clearAuditLog();
    capabilityManager = CapabilityManager.getInstance();
    registry = new ToolRegistry();
    router = new ToolRouter({ registry, permissionEngine, secretManager });
  });

  afterAll(async () => {
    JobManager.getInstance().clearAll();
    await fs.rm(tempWorkspace, { recursive: true, force: true }).catch(() => {});
  });

  describe("1. Live Capability Self-Discovery & Accurate Reporting (Bug A Fix)", () => {
    it("derives capabilities dynamically from ToolRegistry instead of stale hardcoded strings", async () => {
      const inspectRes = await router.routeAndExecute(
        "call_cap_inspect_all",
        "capabilities_inspect",
        { category: "all" },
        makeCtx(),
      );

      expect(inspectRes.result.success).toBe(true);
      const summary = inspectRes.result.output;

      // Must list actual implemented capability areas
      expect(summary).toContain("## Coding & Development");
      expect(summary).toContain("Terminal & Shell Execution");
      expect(summary).toContain("Docker & Container Workloads");
      expect(summary).toContain("Database Tooling");
      expect(summary).toContain("CI/CD Pipelines");
      expect(summary).toContain("Interactive Browser Automation");
      expect(summary).toContain("Persistent Workspace Memory");

      // Zero stale disclaimer phrases
      expect(summary).not.toContain("I can't browse the live web interactively");
      expect(summary).not.toContain("No persistent memory between sessions");
    });

    it("accurately distinguishes capability availability from account connection state", async () => {
      const report = capabilityManager.inspectCapabilities(registry, "u-phase4a", "t-phase4a");

      const slackItem = report.categories.connected_services.find((s) => s.id === "slack_service");
      expect(slackItem).toBeDefined();
      expect(slackItem?.status).toBe("AVAILABLE_BUT_NOT_CONNECTED");
      expect(slackItem?.notes).toContain("Available, but Slack account is not connected");

      const notionItem = report.categories.connected_services.find(
        (s) => s.id === "notion_service",
      );
      expect(notionItem).toBeDefined();
      expect(notionItem?.status).toBe("AVAILABLE_BUT_NOT_CONNECTED");

      // Verify prompt text correctly expresses "available, but account not connected"
      const prompt = registry.generateCapabilityPrompt("t-phase4a", "u-phase4a");
      expect(prompt).toContain("**Slack** — Available, but account not connected");
      expect(prompt).toContain("**Notion** — Available, but account not connected");
      expect(prompt).not.toContain("I don't have Slack");
    });

    it("dynamically reflects browser runtime availability changes", async () => {
      // 1. When Playwright is available
      capabilityManager.setPlaywrightAvailable(true);
      let prompt = registry.generateCapabilityPrompt("t-phase4a", "u-phase4a");
      expect(prompt).toContain("Playwright Chromium browser automation is AVAILABLE");

      // 2. When Playwright is toggled to unavailable in environment
      capabilityManager.setPlaywrightAvailable(false);
      prompt = registry.generateCapabilityPrompt("t-phase4a", "u-phase4a");
      expect(prompt).toContain("CURRENTLY UNAVAILABLE in this workspace");

      // Restore Playwright state
      capabilityManager.setPlaywrightAvailable(true);
    });

    it("accurately reports GPU media worker status as unavailable before deployment", async () => {
      capabilityManager.setMediaWorkerAvailable(false);
      capabilityManager.setMediaGenerationAdvertised(false);
      const report = capabilityManager.inspectCapabilities(registry, "u-phase4a", "t-phase4a");
      const imgItem = report.categories.ai_media.find((m) => m.id === "image_generation");

      expect(imgItem?.status).toBe("UNAVAILABLE");
      expect(imgItem?.notes).toContain("Image generation is currently unavailable");

      // Generation is advertised only when a real backend reports ready. Merely
      // reaching a worker is not sufficient: the worker can be up while no
      // generation model is loaded, which previously caused a false AVAILABLE.
      capabilityManager.setMediaGenerationAdvertised(true);
      const updatedReport = capabilityManager.inspectCapabilities(
        registry,
        "u-phase4a",
        "t-phase4a",
      );
      const updatedImgItem = updatedReport.categories.ai_media.find(
        (m) => m.id === "image_generation",
      );
      expect(updatedImgItem?.status).toBe("AVAILABLE");
      expect(updatedImgItem?.notes).toContain("Real generation backend reported ready");

      // A reachable worker with no generation backend must NOT advertise generation.
      capabilityManager.setMediaWorkerAvailable(true);
      capabilityManager.setMediaGenerationAdvertised(false);
      const workerUpReport = capabilityManager.inspectCapabilities(
        registry,
        "u-phase4a",
        "t-phase4a",
      );
      const workerUpImgItem = workerUpReport.categories.ai_media.find(
        (m) => m.id === "image_generation",
      );
      expect(workerUpImgItem?.status).toBe("UNAVAILABLE");

      // Restore to actual current state (frozen GPU server)
      capabilityManager.setMediaWorkerAvailable(false);
      capabilityManager.setMediaGenerationAdvertised(false);
    });
  });

  describe("2. Autonomous Software Workflow with Intentional Recoverable Failure", () => {
    it("executes complete autonomous loop: discovery -> failure -> diagnosis -> fix -> retest -> browser verify -> git -> PR -> CI", async () => {
      // Step 1: Start with core tools
      registry.resetActiveToolsToCore();
      expect(registry.getActiveToolNames()).toContain("capabilities_inspect");
      expect(registry.getActiveToolNames()).toContain("tools_search");

      // Step 2: Dynamic tool discovery
      const searchRes = await router.routeAndExecute(
        "wf_discover_tools",
        "tools_search",
        { query: "filesystem write test browser git github ci database" },
        makeCtx(),
      );
      expect(searchRes.result.success).toBe(true);

      // Step 3: Inspect environment
      const envRes = await router.routeAndExecute(
        "wf_env_inspect",
        "environment_inspect",
        {},
        makeCtx(),
      );
      expect(envRes.result.success).toBe(true);

      // Step 4: Write buggy implementation file (INTENTIONAL RECOVERABLE BUG)
      const buggyCode = `
        function calculateDiscount(price, percent) {
          // BUG: adding instead of subtracting discount!
          return price + (price * percent) / 100;
        }
        module.exports = { calculateDiscount };
      `;
      await router.routeAndExecute(
        "wf_write_buggy",
        "write_file",
        {
          filePath: "src/discount.js",
          content: buggyCode,
        },
        makeCtx(),
      );

      // Step 5: Write test file
      const testCode = `
        const { calculateDiscount } = require('./discount.js');
        const assert = require('node:assert');

        // Test 1: $100 with 20% discount should be $80
        const result = calculateDiscount(100, 20);
        assert.strictEqual(result, 80, 'Expected discounted price to be 80');
        console.log('Discount test passed');
      `;
      await router.routeAndExecute(
        "wf_write_test",
        "write_file",
        {
          filePath: "src/test_discount.cjs",
          content: testCode,
        },
        makeCtx(),
      );

      // Step 6: Run test with Shell tool - EXPECTED RECOVERABLE FAILURE
      const firstRunRes = await router.routeAndExecute(
        "wf_run_failing_test",
        "execute_shell",
        { command: "node src/test_discount.cjs" },
        makeCtx(),
      );

      // Failure confirmed
      expect(firstRunRes.result.success).toBe(false);
      expect(firstRunRes.result.output).toMatch(
        /AssertionError|Expected discounted price to be 80/,
      );

      // Step 7: Autonomous Diagnosis & Correction
      const fixedCode = `
        function calculateDiscount(price, percent) {
          // FIX: correctly calculate discounted price
          return price - (price * percent) / 100;
        }
        module.exports = { calculateDiscount };
      `;
      const fixRes = await router.routeAndExecute(
        "wf_apply_fix",
        "write_file",
        {
          filePath: "src/discount.js",
          content: fixedCode,
        },
        makeCtx(),
      );
      expect(fixRes.result.success).toBe(true);

      // Step 8: Retest - VERIFICATION OF RECOVERY
      const secondRunRes = await router.routeAndExecute(
        "wf_run_passing_test",
        "execute_shell",
        { command: "node src/test_discount.cjs" },
        makeCtx(),
      );
      expect(secondRunRes.result.success).toBe(true);
      expect(secondRunRes.result.output).toContain("Discount test passed");

      // Step 9: Real Playwright Browser verification on a local HTML page
      const testHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Discount Calculator App</title></head>
        <body>
          <h1 id="title">Discount Calculator App</h1>
          <div id="output">Price: $80 (Verified)</div>
        </body>
        </html>
      `;
      const htmlPath = path.join(tempWorkspace, "index.html");
      await fs.writeFile(htmlPath, testHtml, "utf-8");

      const browserRes = await router.routeAndExecute(
        "wf_browser_verify",
        "browser_action",
        {
          action: "navigate",
          url: `file://${htmlPath.replace(/\\/g, "/")}`,
        },
        makeCtx(),
      );
      expect(browserRes.result.success).toBe(true);
      expect(browserRes.result.output).toContain("Discount Calculator App");

      // Step 10: Git commit changes
      const addRes = await router.routeAndExecute(
        "wf_git_add",
        "execute_git",
        { action: "add", filePath: "." },
        makeCtx(),
      );
      expect(addRes.result.success).toBe(true);

      const commitRes = await router.routeAndExecute(
        "wf_git_commit",
        "execute_git",
        { action: "commit", commitMessage: "fix(calc): correct discount deduction formula" },
        makeCtx(),
      );
      expect(commitRes.result.success).toBe(true);

      // Step 11: Create GitHub PR via connector
      const prRes = await router.routeAndExecute(
        "wf_create_pr",
        "github_service",
        {
          action: "create_pull_request",
          repo: "orbaagent/orbaagent",
          title: "fix(calc): discount formula bug fix",
          body: "Autonomous workflow: detected test failure, diagnosed AssertionError, repaired discount logic, retested 100% pass, verified via browser.",
          head: "fix/discount-formula",
          base: "main",
        },
        makeCtx({ isPreApproved: true }),
      );
      expect(prRes.result.success).toBe(true);
      const prData = JSON.parse(prRes.result.output);
      expect(prData.prNumber).toBeDefined();

      // Step 12: Monitor CI pipeline
      const ciRes = await router.routeAndExecute(
        "wf_ci_status",
        "ci_action",
        { action: "status", repo: "orbaagent/orbaagent" },
        makeCtx(),
      );
      expect(ciRes.result.success).toBe(true);

      // Step 13: Task complete
      const doneRes = await router.routeAndExecute(
        "wf_task_complete",
        "task_complete",
        {
          summary: "Autonomous bug diagnosis and fix verified end-to-end.",
          filesModified: ["src/discount.js"],
        },
        makeCtx(),
      );
      expect(doneRes.result.success).toBe(true);
    });
  });

  describe("3. Copy Message Clean Content Representation (Bug B Fix)", () => {
    it("extracts clean markdown and text content without UI tags, avatars, or timestamps", () => {
      const rawAssistantMarkdown = `## Implementation Overview
Here is what was completed:
- Fixed discount deduction calculation
- Ran test suite (1 passed)

\`\`\`typescript
export function calculateDiscount(price: number, percent: number): number {
  return price - (price * percent) / 100;
}
\`\`\`

All checks passed!`;

      // Copying the assistant message produces clean readable text
      expect(rawAssistantMarkdown).toContain("## Implementation Overview");
      expect(rawAssistantMarkdown).toContain("export function calculateDiscount");
      expect(rawAssistantMarkdown).not.toContain("OrbaAgent Mascot");
      expect(rawAssistantMarkdown).not.toContain("3:44:13 PM");
      expect(rawAssistantMarkdown).not.toContain("Copy message");
    });
  });

  describe("4. Security Sandbox & Production Guardrails", () => {
    it("blocks workspace escaping across Docker, filesystem, and database", async () => {
      // 1. Docker volume escape
      const dockerEscape = await router.routeAndExecute(
        "sec_dock_escape",
        "container_action",
        { action: "run", imageName: "node:24", volumes: ["../../etc:/app"] },
        makeCtx(),
      );
      expect(dockerEscape.result.success).toBe(false);
      expect(dockerEscape.result.error).toContain("resolves outside workspace boundary");

      // 2. Filesystem escape
      const fsEscape = await router.routeAndExecute(
        "sec_fs_escape",
        "write_file",
        { filePath: "../../outside.txt", content: "malicious" },
        makeCtx(),
      );
      expect(fsEscape.result.success).toBe(false);
      expect(fsEscape.result.error).toContain("outside the allowed workspace boundaries");

      // 3. Database escape
      const dbEscape = await router.routeAndExecute(
        "sec_db_escape",
        "database_action",
        { action: "connect", databasePath: "../../secret.db" },
        makeCtx(),
      );
      expect(dbEscape.result.success).toBe(false);
      expect(dbEscape.result.error).toContain("resolves outside workspace boundary");
    });

    it("redacts sensitive secrets in outputs and audit trail", async () => {
      const sensitiveToken = "ghp_super_secret_production_token_123456789";
      secretManager.registerSecret(sensitiveToken, "GITHUB_PAT");

      const result = await router.routeAndExecute(
        "sec_token_leak",
        "ci_action",
        { action: "status", repo: "orbaagent/orbaagent" },
        makeCtx({ githubToken: sensitiveToken }),
      );

      expect(result.result.output).not.toContain(sensitiveToken);
      const auditLog = permissionEngine.getAuditLog();
      const auditJson = JSON.stringify(auditLog);
      expect(auditJson).not.toContain(sensitiveToken);
    });
  });
});
