import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EnvironmentInspectTool,
  FilesystemCopyTool,
  FilesystemDeleteTool,
  FilesystemMoveTool,
  FilesystemSearchTool,
  FilesystemStatTool,
  GitTool,
  PermissionEngine,
  ProcessManager,
  ProcessManagerTool,
  SecretManager,
  ToolRegistry,
  ToolRouter,
  ToolsSearchTool,
} from "./index.js";

describe("OrbaAgent Runtime & Security Foundation", () => {
  let tempWorkspace: string;
  let registry: ToolRegistry;
  let router: ToolRouter;
  let permissionEngine: PermissionEngine;
  let secretManager: SecretManager;

  beforeAll(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "orbaagent-runtime-test-"));
    // Create some initial files inside workspace
    await fs.writeFile(path.join(tempWorkspace, "hello.txt"), "Hello OrbaAgent World!\nSecret key is sk-1234567890abcdef1234567890");
    await fs.mkdir(path.join(tempWorkspace, "src"), { recursive: true });
    await fs.writeFile(path.join(tempWorkspace, "src", "index.ts"), "export const PI = 3.14159;\n// Searchable token");

    secretManager = SecretManager.getInstance();
    permissionEngine = PermissionEngine.getInstance();
    registry = new ToolRegistry();
    router = new ToolRouter({ registry, permissionEngine, secretManager });
  });

  afterAll(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("Dynamic Tool Discovery & Schema Pruning", () => {
    it("starts with ONLY core tools on turn 0, reducing tool context size by >65%", () => {
      registry.resetActiveToolsToCore();
      const activeTools = registry.getActiveToolNames();
      const activeDefs = registry.getActiveToolDefinitions();
      const allDefs = registry.getAllToolDefinitions();

      expect(activeTools).toEqual([
        "tools_search",
        "environment_inspect",
        "capabilities_inspect",
        "task_complete",
      ]);
      expect(activeDefs.length).toBe(4);
      expect(allDefs.length).toBeGreaterThanOrEqual(15);

      const reductionPct = ((allDefs.length - activeDefs.length) / allDefs.length) * 100;
      expect(reductionPct).toBeGreaterThan(65);
    });

    it("searches and dynamically activates tools using tools_search", async () => {
      const searchTool = registry.getTool("tools_search") as ToolsSearchTool;
      expect(searchTool).toBeDefined();

      const result = await searchTool.execute(
        { query: "filesystem grep search", limit: 5 },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
        },
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("filesystem_search");

      // Verify filesystem_search is now dynamically active in the registry!
      const activeTools = registry.getActiveToolNames();
      expect(activeTools).toContain("filesystem_search");
    });

    it("resets and prunes active tools back to core without losing core tools", () => {
      registry.activateTools(["filesystem_search", "execute_git", "process_manager"]);
      expect(registry.getActiveToolNames().length).toBeGreaterThan(3);

      registry.pruneTools();
      expect(registry.getActiveToolNames()).toEqual([
        "tools_search",
        "environment_inspect",
        "capabilities_inspect",
        "task_complete",
      ]);
    });
  });

  describe("Real Environment Inspection", () => {
    it("inspects real host OS, CPUs, RAM, and runtime versions without hallucination", async () => {
      const envTool = new EnvironmentInspectTool();
      const result = await envTool.execute(
        { verbose: true },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
        },
      );

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output);
      expect(data.os.platform).toBe(os.platform());
      expect(data.hardware.cpuCount).toBeGreaterThan(0);
      expect(data.runtimes.node).toBe(process.version);
    });
  });

  describe("Extended Filesystem Execution & Workspace Safety", () => {
    it("searches content with filesystem_search within workspace", async () => {
      const searchTool = new FilesystemSearchTool();
      const result = await searchTool.execute(
        { query: "3.14159", contentMatch: true },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
        },
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("src/index.ts");
    });

    it("gets file metadata with filesystem_stat", async () => {
      const statTool = new FilesystemStatTool();
      const result = await statTool.execute(
        { path: "hello.txt" },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
        },
      );

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.isFile).toBe(true);
      expect(parsed.sizeBytes).toBeGreaterThan(0);
    });

    it("copies and moves files safely within workspace", async () => {
      const copyTool = new FilesystemCopyTool();
      const moveTool = new FilesystemMoveTool();
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      const copyRes = await copyTool.execute(
        { sourcePath: "hello.txt", destinationPath: "hello_copy.txt" },
        context,
      );
      expect(copyRes.success).toBe(true);

      const moveRes = await moveTool.execute(
        { sourcePath: "hello_copy.txt", destinationPath: "hello_renamed.txt" },
        context,
      );
      expect(moveRes.success).toBe(true);

      const exists = await fs
        .access(path.join(tempWorkspace, "hello_renamed.txt"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("BLOCKS path traversal outside workspace scope", async () => {
      const { result, auditEvent } = await router.routeAndExecute(
        "call_bad_path",
        "filesystem_stat",
        { path: "../../Windows/System32/drivers/etc/hosts" },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission Denied");
      expect(result.error).toContain("outside the allowed workspace boundaries");
      expect(auditEvent?.approved).toBe(false);
    });

    it("BLOCKS deleting workspace root directly", async () => {
      const { result } = await router.routeAndExecute(
        "call_del_root",
        "filesystem_delete",
        { path: "." },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
          isPreApproved: true,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission Denied");
    });

    it("BLOCKS destructive filesystem_delete without pre-approval", async () => {
      const { result, auditEvent } = await router.routeAndExecute(
        "call_del_no_approval",
        "filesystem_delete",
        { path: "hello_renamed.txt" },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
          isPreApproved: false, // NOT approved!
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("TIER_4_DESTRUCTIVE");
      expect(result.error).toContain("requires explicit pre-approval");
      expect(auditEvent?.approved).toBe(false);
    });

    it("ALLOWS destructive delete when pre-approved within workspace bounds", async () => {
      const { result, auditEvent } = await router.routeAndExecute(
        "call_del_approved",
        "filesystem_delete",
        { path: "hello_renamed.txt" },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
          isPreApproved: true, // Approved!
        },
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Deleted 'hello_renamed.txt' successfully");
      expect(auditEvent?.approved).toBe(true);
    });
  });

  describe("Git Extended & Force-Push Guard", () => {
    it("BLOCKS unverified git push --force", async () => {
      const { result, auditEvent } = await router.routeAndExecute(
        "call_git_force",
        "execute_git",
        { action: "push", extraArgs: "--force origin main" },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
          isPreApproved: false,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("force push");
      expect(auditEvent?.approved).toBe(false);
    });
  });

  describe("Process Lifecycle & Host PID Protection", () => {
    it("BLOCKS terminating external host PIDs (e.g. PID 1, PID 11416)", async () => {
      const { result, auditEvent } = await router.routeAndExecute(
        "call_kill_external",
        "process_manager",
        { action: "kill", processId: "11416" },
        {
          workspaceDir: tempWorkspace,
          tenantId: "t1",
          userId: "u1",
          agentRunId: "run1",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not an OrbaAgent-managed process");
      expect(result.error).toContain("strictly forbidden");
      expect(auditEvent?.approved).toBe(false);
    });

    it("starts, lists, inspects, and safely kills an OrbaAgent-managed background process", async () => {
      const procTool = new ProcessManagerTool();
      const context = {
        workspaceDir: tempWorkspace,
        tenantId: "t1",
        userId: "u1",
        agentRunId: "run1",
      };

      // Start a long-running process (sleep/ping)
      const isWin = os.platform() === "win32";
      const cmd = isWin ? "powershell -Command Start-Sleep -Seconds 30" : "sleep 30";

      const startRes = await procTool.execute({ action: "start", command: cmd }, context);
      expect(startRes.success).toBe(true);
      const procId = (startRes.metadata as any)?.processId;
      expect(procId).toBeDefined();

      // List processes
      const listRes = await procTool.execute({ action: "list" }, context);
      expect(listRes.success).toBe(true);
      expect(listRes.output).toContain(procId);

      // Inspect process
      const inspectRes = await procTool.execute({ action: "inspect", processId: procId }, context);
      expect(inspectRes.success).toBe(true);
      expect(inspectRes.output).toContain(procId);

      // Kill process
      const killRes = await procTool.execute({ action: "kill", processId: procId }, context);
      expect(killRes.success).toBe(true);
      expect(killRes.output).toContain("Successfully killed managed process");
    });
  });

  describe("Secret Isolation & Masking", () => {
    it("redacts raw tokens and registered credentials in outputs and logs", () => {
      secretManager.registerSecret("super-secret-pat-xyz12345", "TEST_SECRET");

      const textWithSecret = "Found token super-secret-pat-xyz12345 and sk-abcdef01234567890abcdef0 in log";
      const redacted = secretManager.redact(textWithSecret);

      expect(redacted).not.toContain("super-secret-pat-xyz12345");
      expect(redacted).not.toContain("sk-abcdef01234567890abcdef0");
      expect(redacted).toContain("***REDACTED***");
    });

    it("sanitizes child process environment so sensitive host tokens are not leaked", () => {
      const dirtyEnv = {
        PATH: "/usr/bin",
        HOME: "/home/user",
        GITHUB_TOKEN: "ghp_1234567890abcdef1234567890",
        OPENROUTER_API_KEY: "sk-or-secret",
        LANGDOCK_API_KEY: "sk-ld-secret",
        DATABASE_URL: "postgres://user:pass@localhost:5432/db",
        NORMAL_VAR: "safe_value",
      };

      const safeEnv = secretManager.sanitizeChildEnv(dirtyEnv);

      expect(safeEnv.PATH).toBe("/usr/bin");
      expect(safeEnv.NORMAL_VAR).toBe("safe_value");
      expect(safeEnv.GITHUB_TOKEN).toBeUndefined();
      expect(safeEnv.OPENROUTER_API_KEY).toBeUndefined();
      expect(safeEnv.LANGDOCK_API_KEY).toBeUndefined();
      expect(safeEnv.DATABASE_URL).toBeUndefined();
    });
  });
});
