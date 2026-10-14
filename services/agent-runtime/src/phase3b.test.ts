import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execAsync = promisify(exec);
import {
  BackgroundJobTool,
  CITool,
  ConnectorProvider,
  ContainerTool,
  DatabaseTool,
  DeploymentTool,
  GitHubConnector,
  GitHubServiceTool,
  GoogleWorkspaceServiceTool,
  JobManager,
  Microsoft365ServiceTool,
  NativeProvider,
  NotionServiceTool,
  PermissionEngine,
  SecretManager,
  SlackServiceTool,
  ToolRegistry,
  ToolRouter,
} from "./index.js";

describe("Phase 3B: Autonomous Infrastructure, Databases, CI/CD, Connectors & Jobs", () => {
  let tempWorkspace: string;
  let registry: ToolRegistry;
  let router: ToolRouter;
  let permissionEngine: PermissionEngine;
  let secretManager: SecretManager;

  beforeAll(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "orbaagent-phase3b-test-"));
    await execAsync("git init", { cwd: tempWorkspace });
    await execAsync('git config user.email "test@orbaagent.dev"', { cwd: tempWorkspace });
    await execAsync('git config user.name "OrbaAgent Test"', { cwd: tempWorkspace });
    secretManager = SecretManager.getInstance();
    permissionEngine = PermissionEngine.getInstance();
    permissionEngine.clearAuditLog();
    registry = new ToolRegistry();
    router = new ToolRouter({ registry, permissionEngine, secretManager });
  });

  afterAll(async () => {
    JobManager.getInstance().clearAll();
    await fs.rm(tempWorkspace, { recursive: true, force: true }).catch(() => {});
  });

  describe("1. Docker & Container Workload Sandboxing", () => {
    it("strictly blocks volume mounts attempting to escape workspace boundary", async () => {
      const containerTool = new ContainerTool();

      // Outside workspace volume
      expect(() => {
        containerTool.validateVolumeMounts(["../../etc/shadow:/etc/shadow"], tempWorkspace);
      }).toThrow(/resolves outside workspace boundary/);

      // System root volume
      expect(() => {
        containerTool.validateVolumeMounts(["C:\\Windows:/host_root"], tempWorkspace);
      }).toThrow(/resolves outside workspace boundary/);

      // Safe workspace volume
      expect(() => {
        containerTool.validateVolumeMounts(["./src:/app/src", "data:/app/data"], tempWorkspace);
      }).not.toThrow();
    });

    it("strictly blocks dangerous container privilege and host namespace flags", async () => {
      const containerTool = new ContainerTool();

      expect(() => {
        containerTool.validateSecurityFlags("--privileged");
      }).toThrow(/blocked by sandbox policy/);

      expect(() => {
        containerTool.validateSecurityFlags("--pid=host --ipc=host");
      }).toThrow(/blocked by sandbox policy/);

      expect(() => {
        containerTool.validateSecurityFlags("--net=host");
      }).toThrow(/blocked by sandbox policy/);

      expect(() => {
        containerTool.validateSecurityFlags("-v /:/host");
      }).toThrow(/blocked by sandbox policy/);
    });

    it("evaluates container operations through PermissionEngine with boundary denial", async () => {
      const result = await router.routeAndExecute(
        "call_cont_deny_1",
        "container_action",
        {
          action: "run",
          imageName: "alpine:latest",
          volumes: ["../../sensitive:/data"],
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-docker",
          userId: "u-docker",
        },
      );

      expect(result.result.success).toBe(false);
      expect(result.result.error).toContain("resolves outside workspace boundary");
      expect(result.auditEvent?.approved).toBe(false);
    });

    it("blocks privileged flags at the PermissionEngine layer before execution", async () => {
      const result = await router.routeAndExecute(
        "call_cont_deny_2",
        "container_action",
        {
          action: "run",
          imageName: "alpine:latest",
          extraArgs: "--privileged",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-docker",
          userId: "u-docker",
        },
      );

      expect(result.result.success).toBe(false);
      expect(result.result.error).toContain("blocked by sandbox security policy");
      expect(result.auditEvent?.approved).toBe(false);
    });

    it("handles container CLI execution safely and reports daemon status gracefully", async () => {
      const result = await router.routeAndExecute(
        "call_cont_list",
        "container_action",
        { action: "list" },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-docker",
          userId: "u-docker",
        },
      );

      // Either docker is running on test machine or graceful fallback error returned
      if (result.result.success) {
        expect(typeof result.result.output).toBe("string");
      } else {
        expect(result.result.error).toMatch(/Docker|daemon|command failed|not recognized/i);
      }
    });
  });

  describe("2. Database Operations (Native Node 24 SQLite)", () => {
    const dbFile = "test_inventory.db";

    it("connects to a SQLite database within workspace", async () => {
      const result = await router.routeAndExecute(
        "call_db_connect",
        "database_action",
        {
          action: "connect",
          engine: "sqlite",
          databasePath: dbFile,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(result.result.success).toBe(true);
      expect(result.result.output).toContain("Successfully connected to SQLite");
    });

    it("creates table and inserts rows using structured query execution", async () => {
      const createTableSql = `
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price REAL NOT NULL,
          sku TEXT UNIQUE,
          stock INTEGER DEFAULT 0
        );
      `;

      const createRes = await router.routeAndExecute(
        "call_db_create",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: dbFile,
          query: createTableSql,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(createRes.result.success).toBe(true);

      // Insert multiple records
      const insertSql = `
        INSERT INTO products (name, price, sku, stock) VALUES
        ('Widget A', 19.99, 'SKU-001', 100),
        ('Widget B', 49.50, 'SKU-002', 25),
        ('Enterprise Module', 999.00, 'SKU-003', 5);
      `;

      const insertRes = await router.routeAndExecute(
        "call_db_insert",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: dbFile,
          query: insertSql,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(insertRes.result.success).toBe(true);

      // Select records back
      const selectRes = await router.routeAndExecute(
        "call_db_select",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: dbFile,
          query: "SELECT id, name, price, sku, stock FROM products ORDER BY id ASC;",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(selectRes.result.success).toBe(true);
      const rows = JSON.parse(selectRes.result.output);
      expect(rows).toHaveLength(3);
      expect(rows[0].name).toBe("Widget A");
      expect(rows[1].sku).toBe("SKU-002");
      expect(rows[2].price).toBe(999);
    });

    it("introspects schema and table metadata", async () => {
      const result = await router.routeAndExecute(
        "call_db_schema",
        "database_action",
        {
          action: "schema",
          engine: "sqlite",
          databasePath: dbFile,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(result.result.success).toBe(true);
      const schemaData = JSON.parse(result.result.output);
      expect(schemaData.tables).toContain("products");
      expect(schemaData.schema.products.some((c: any) => c.name === "sku")).toBe(true);
    });

    it("explains query execution plan", async () => {
      const result = await router.routeAndExecute(
        "call_db_explain",
        "database_action",
        {
          action: "explain",
          engine: "sqlite",
          databasePath: dbFile,
          query: "SELECT * FROM products WHERE sku = 'SKU-001';",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(result.result.success).toBe(true);
      expect(result.result.output).toMatch(/SCAN|SEARCH|INDEX/);
    });

    it("executes multi-statement SQL migration file", async () => {
      const migrationFile = "migrations/001_add_orders.sql";
      const migrationDirPath = path.join(tempWorkspace, "migrations");
      await fs.mkdir(migrationDirPath, { recursive: true });

      const migrationSql = `
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER,
          quantity INTEGER,
          total REAL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO orders (product_id, quantity, total) VALUES (1, 2, 39.98);
      `;
      await fs.writeFile(path.join(tempWorkspace, migrationFile), migrationSql, "utf-8");

      const result = await router.routeAndExecute(
        "call_db_migrate",
        "database_action",
        {
          action: "migrate",
          engine: "sqlite",
          databasePath: dbFile,
          migrationPath: migrationFile,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(result.result.success).toBe(true);
      expect(result.result.output).toContain("executed successfully");

      // Verify orders table was created and has row
      const selectOrders = await router.routeAndExecute(
        "call_db_check_orders",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: dbFile,
          query: "SELECT COUNT(*) as total FROM orders;",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(selectOrders.result.success).toBe(true);
      const countRow = JSON.parse(selectOrders.result.output);
      expect(countRow[0].total).toBe(1);
    });

    it("creates a full database SQL backup file", async () => {
      const backupFile = "backups/inventory_backup.sql";
      await fs.mkdir(path.join(tempWorkspace, "backups"), { recursive: true });

      const result = await router.routeAndExecute(
        "call_db_backup",
        "database_action",
        {
          action: "backup",
          engine: "sqlite",
          databasePath: dbFile,
          backupPath: backupFile,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(result.result.success).toBe(true);
      expect(result.result.output).toContain("Backup created at");

      // Verify backup file exists and has content
      const content = await fs.readFile(path.join(tempWorkspace, backupFile), "utf-8");
      expect(content).toContain('INSERT INTO "products"');
      expect(content).toContain("Widget A");
      expect(content).toContain('INSERT INTO "orders"');
    });

    it("blocks destructive queries unless explicitly pre-approved", async () => {
      // Unapproved DROP TABLE
      const dropRes = await router.routeAndExecute(
        "call_db_drop_unapproved",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: dbFile,
          query: "DROP TABLE products;",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
          isPreApproved: false,
        },
      );

      expect(dropRes.result.success).toBe(false);
      expect(dropRes.result.error).toContain(
        "Destructive database query requires explicit pre-approval",
      );

      // Pre-approved DROP TABLE
      const approvedDrop = await router.routeAndExecute(
        "call_db_drop_approved",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: dbFile,
          query: "DROP TABLE orders;",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
          isPreApproved: true,
        },
      );

      expect(approvedDrop.result.success).toBe(true);
    });

    it("redacts credentials from database connection strings", async () => {
      const sensitivePassword = "super_secret_db_pass_9988!";
      const connectionString = `postgres://app_user:${sensitivePassword}@db.internal.corp:5432/production`;

      const result = await router.routeAndExecute(
        "call_db_conn_str",
        "database_action",
        {
          action: "connect",
          engine: "postgres",
          connectionString,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-db",
          userId: "u-db",
        },
      );

      expect(result.result.success).toBe(true);
      expect(result.result.output).not.toContain(sensitivePassword);
      expect(result.result.output).toContain("REDACTED");
    });
  });

  describe("3. CI/CD Operations (GitHub Actions Integration)", () => {
    it("retrieves CI pipeline status with structured run info", async () => {
      const result = await router.routeAndExecute(
        "call_ci_status",
        "ci_action",
        {
          action: "status",
          repo: "orbaagent/orbaagent",
          branch: "main",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-ci",
          userId: "u-ci",
        },
      );

      expect(result.result.success).toBe(true);
      const parsed = JSON.parse(result.result.output);
      expect(parsed.repository).toBe("orbaagent/orbaagent");
      expect(Array.isArray(parsed.runs)).toBe(true);
      expect(parsed.runs.length).toBeGreaterThan(0);
      expect(parsed.runs[0].status).toBeDefined();
    });

    it("retrieves workflow logs and verifies step output", async () => {
      const result = await router.routeAndExecute(
        "call_ci_logs",
        "ci_action",
        {
          action: "logs",
          repo: "orbaagent/orbaagent",
          runId: 102489,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-ci",
          userId: "u-ci",
        },
      );

      expect(result.result.success).toBe(true);
      expect(result.result.output).toContain("Setup Node.js");
      expect(result.result.output).toContain("CI Status: SUCCESS");
    });

    it("dispatches workflow rerun and cancel actions", async () => {
      const rerunRes = await router.routeAndExecute(
        "call_ci_rerun",
        "ci_action",
        {
          action: "rerun",
          repo: "orbaagent/orbaagent",
          runId: 102489,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-ci",
          userId: "u-ci",
        },
      );

      expect(rerunRes.result.success).toBe(true);
      expect(rerunRes.result.output).toContain("Status: QUEUED");

      const cancelRes = await router.routeAndExecute(
        "call_ci_cancel",
        "ci_action",
        {
          action: "cancel",
          repo: "orbaagent/orbaagent",
          runId: 102489,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-ci",
          userId: "u-ci",
        },
      );

      expect(cancelRes.result.success).toBe(true);
      expect(cancelRes.result.output).toContain("Cancelled workflow run");
    });

    it("lists build artifacts generated by workflow", async () => {
      const result = await router.routeAndExecute(
        "call_ci_artifacts",
        "ci_action",
        {
          action: "artifacts",
          runId: 102489,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-ci",
          userId: "u-ci",
        },
      );

      expect(result.result.success).toBe(true);
      const parsed = JSON.parse(result.result.output);
      expect(Array.isArray(parsed.artifacts)).toBe(true);
      expect(parsed.artifacts.some((a: any) => a.name === "test-coverage-report")).toBe(true);
    });
  });

  describe("4. Multi-Cloud Deployments (Vercel, Cloudflare, Supabase)", () => {
    it("creates deployments across providers and returns endpoints", async () => {
      const vercelRes = await router.routeAndExecute(
        "call_dep_vercel",
        "deployment_action",
        {
          action: "create",
          provider: "vercel",
          projectName: "orba-web",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-cloud",
          userId: "u-cloud",
        },
      );

      expect(vercelRes.result.success).toBe(true);
      const vercelData = JSON.parse(vercelRes.result.output);
      expect(vercelData.provider).toBe("vercel");
      expect(vercelData.url).toContain("vercel.app");

      const cfRes = await router.routeAndExecute(
        "call_dep_cf",
        "deployment_action",
        {
          action: "create",
          provider: "cloudflare",
          projectName: "orba-docs",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-cloud",
          userId: "u-cloud",
        },
      );

      expect(cfRes.result.success).toBe(true);
      const cfData = JSON.parse(cfRes.result.output);
      expect(cfData.url).toContain("pages.dev");
    });

    it("queries deployment status, health, and logs", async () => {
      const statusRes = await router.routeAndExecute(
        "call_dep_status",
        "deployment_action",
        {
          action: "status",
          provider: "vercel",
          projectName: "orba-web",
          deploymentId: "dep_90210",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-cloud",
          userId: "u-cloud",
        },
      );

      expect(statusRes.result.success).toBe(true);
      const statusData = JSON.parse(statusRes.result.output);
      expect(statusData.state).toBe("READY");
      expect(statusData.health).toBe("HEALTHY");

      const logsRes = await router.routeAndExecute(
        "call_dep_logs",
        "deployment_action",
        {
          action: "logs",
          provider: "vercel",
          projectName: "orba-web",
          deploymentId: "dep_90210",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-cloud",
          userId: "u-cloud",
        },
      );

      expect(logsRes.result.success).toBe(true);
      expect(logsRes.result.output).toContain("Deployed to production");
    });

    it("manages environment variables and sanitizes sensitive values", async () => {
      const secretApiKey = "stripe_live_sk_88374829374982";
      const envRes = await router.routeAndExecute(
        "call_dep_env",
        "deployment_action",
        {
          action: "environment",
          provider: "vercel",
          projectName: "orba-web",
          envVars: {
            STRIPE_KEY: secretApiKey,
            NODE_ENV: "production",
          },
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-cloud",
          userId: "u-cloud",
        },
      );

      expect(envRes.result.success).toBe(true);
      expect(envRes.result.output).not.toContain(secretApiKey);
    });

    it("performs rollback to previous deployment ID", async () => {
      const rollbackRes = await router.routeAndExecute(
        "call_dep_rollback",
        "deployment_action",
        {
          action: "rollback",
          provider: "vercel",
          projectName: "orba-web",
          deploymentId: "dep_prev_7712",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-cloud",
          userId: "u-cloud",
        },
      );

      expect(rollbackRes.result.success).toBe(true);
      expect(rollbackRes.result.output).toContain("Successfully rolled back");
      expect(rollbackRes.result.output).toContain("dep_prev_7712");
    });
  });

  describe("5. Connector Architecture & Connected SaaS Tools", () => {
    it("verifies 3 first-class provider types in registry architecture", async () => {
      const nativeProvider = registry.getNativeProvider();
      const mcpProvider = registry.getMcpProvider();
      const connectorProvider = registry.getConnectorProvider();

      expect(nativeProvider).toBeInstanceOf(NativeProvider);
      expect(mcpProvider).toBeDefined();
      expect(connectorProvider).toBeInstanceOf(ConnectorProvider);

      const connectors = connectorProvider.listConnectors();
      expect(connectors.some((c) => c.id === "github")).toBe(true);
      expect(connectors.some((c) => c.id === "slack")).toBe(true);
      expect(connectors.some((c) => c.id === "notion")).toBe(true);
    });

    it("executes GitHub connector service (create PR, list issues, comment)", async () => {
      // 1. Create Pull Request
      const prRes = await router.routeAndExecute(
        "call_gh_pr",
        "github_service",
        {
          action: "create_pull_request",
          repo: "orbaagent/orbaagent",
          title: "feat: Phase 3B Complete",
          body: "Full autonomous deployment capabilities verified",
          head: "feat/phase3b",
          base: "main",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
          isPreApproved: true,
        },
      );

      expect(prRes.result.success).toBe(true);
      const prData = JSON.parse(prRes.result.output);
      expect(prData.prNumber).toBeDefined();
      expect(prData.url).toContain("pull/");

      // 2. List Issues
      const issuesRes = await router.routeAndExecute(
        "call_gh_issues",
        "github_service",
        {
          action: "list_issues",
          repo: "orbaagent/orbaagent",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(issuesRes.result.success).toBe(true);
      const issues = JSON.parse(issuesRes.result.output);
      expect(Array.isArray(issues)).toBe(true);

      // 3. Add Comment
      const commentRes = await router.routeAndExecute(
        "call_gh_comment",
        "github_service",
        {
          action: "add_comment",
          repo: "orbaagent/orbaagent",
          issueNumber: 12,
          body: "Automated verification completed successfully.",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
          isPreApproved: true,
        },
      );

      expect(commentRes.result.success).toBe(true);
      expect(commentRes.result.output).toContain("Added comment");
    });

    it("executes Slack connector service (post message and list channels)", async () => {
      const postRes = await router.routeAndExecute(
        "call_slack_post",
        "slack_service",
        {
          action: "post_message",
          channel: "#deployments",
          message: "Production deployment ready for verification.",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(postRes.result.success).toBe(true);
      expect(postRes.result.output).toContain("Message posted to Slack channel '#deployments'");

      const channelsRes = await router.routeAndExecute(
        "call_slack_channels",
        "slack_service",
        { action: "list_channels" },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(channelsRes.result.success).toBe(true);
      const channels = JSON.parse(channelsRes.result.output);
      expect(channels.some((c: any) => c.name === "deployments")).toBe(true);
    });

    it("executes Notion connector service (create page and search)", async () => {
      const pageRes = await router.routeAndExecute(
        "call_notion_create",
        "notion_service",
        {
          action: "create_page",
          title: "Phase 3B Architecture Verification",
          content: "Comprehensive automated verification notes",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(pageRes.result.success).toBe(true);
      expect(pageRes.result.output).toContain("Created Notion page");

      const searchRes = await router.routeAndExecute(
        "call_notion_search",
        "notion_service",
        {
          action: "search",
          query: "Architecture",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(searchRes.result.success).toBe(true);
      const results = JSON.parse(searchRes.result.output);
      expect(Array.isArray(results)).toBe(true);
    });

    it("executes Google Workspace and Microsoft 365 connectors", async () => {
      const gwRes = await router.routeAndExecute(
        "call_gw_search",
        "google_workspace_service",
        {
          action: "search_drive",
          query: "Specs",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(gwRes.result.success).toBe(true);
      expect(gwRes.result.output).toContain("Google Workspace");

      const m365Res = await router.routeAndExecute(
        "call_m365_msg",
        "microsoft_365_service",
        {
          action: "send_teams_message",
          channel: "General",
          message: "All services healthy.",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-conn",
          userId: "u-conn",
        },
      );

      expect(m365Res.result.success).toBe(true);
      expect(m365Res.result.output).toContain("Microsoft 365 action");
    });
  });

  describe("6. Persistent Background Job Manager", () => {
    it("creates, tracks, pauses, resumes, and cancels background jobs across turns", async () => {
      // 1. Start job
      const startRes = await router.routeAndExecute(
        "call_job_start",
        "job_manager",
        {
          action: "start",
          name: "compile-monorepo-task",
          payload: { target: "all" },
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(startRes.result.success).toBe(true);
      const startedMeta = startRes.result.metadata as any;
      const jobId = startedMeta.id;
      expect(jobId).toMatch(/^job_/);
      expect(startedMeta.status).toBe("RUNNING");

      // 2. Status inspection
      const statusRes = await router.routeAndExecute(
        "call_job_status",
        "job_manager",
        {
          action: "status",
          jobId,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(statusRes.result.success).toBe(true);
      const inspected = JSON.parse(statusRes.result.output);
      expect(inspected.id).toBe(jobId);

      // 3. Pause job
      const pauseRes = await router.routeAndExecute(
        "call_job_pause",
        "job_manager",
        {
          action: "pause",
          jobId,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(pauseRes.result.success).toBe(true);
      expect(pauseRes.result.output).toContain("paused");

      // Verify status is PAUSED
      const afterPause = JobManager.getInstance().getJob(jobId);
      expect(afterPause?.status).toBe("PAUSED");

      // 4. Resume job
      const resumeRes = await router.routeAndExecute(
        "call_job_resume",
        "job_manager",
        {
          action: "resume",
          jobId,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(resumeRes.result.success).toBe(true);
      expect(resumeRes.result.output).toContain("resumed");

      const afterResume = JobManager.getInstance().getJob(jobId);
      expect(afterResume?.status).toBe("RUNNING");

      // 5. Cancel job
      const cancelRes = await router.routeAndExecute(
        "call_job_cancel",
        "job_manager",
        {
          action: "cancel",
          jobId,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(cancelRes.result.success).toBe(true);
      expect(cancelRes.result.output).toContain("cancelled");

      const afterCancel = JobManager.getInstance().getJob(jobId);
      expect(afterCancel?.status).toBe("CANCELLED");
    });

    it("schedules a delayed job and verifies lifecycle transition", async () => {
      const schedRes = await router.routeAndExecute(
        "call_job_sched",
        "job_manager",
        {
          action: "schedule",
          name: "healthcheck-poll",
          delayMs: 100,
          payload: { endpoint: "https://api.internal/health" },
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(schedRes.result.success).toBe(true);
      const schedMeta = schedRes.result.metadata as any;
      const schedJobId = schedMeta.id;
      expect(schedMeta.status).toBe("WAITING");

      // Wait for scheduled timer execution (100ms delay + 500ms completion)
      await new Promise((r) => setTimeout(r, 750));

      const jobRecord = JobManager.getInstance().getJob(schedJobId);
      expect(jobRecord?.status).toBe("COMPLETED");
      expect(jobRecord?.progress).toBe(100);
    });

    it("lists jobs with status filters", async () => {
      const listRes = await router.routeAndExecute(
        "call_job_list",
        "job_manager",
        {
          action: "list",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-job",
          userId: "u-job",
        },
      );

      expect(listRes.result.success).toBe(true);
      const jobs = JSON.parse(listRes.result.output);
      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("7. Autonomous Multi-Step Development & Deployment Workflow", () => {
    it("executes an end-to-end loop: discovery -> file edit -> database migration -> test -> commit -> PR -> CI monitor -> completion", async () => {
      // 1. Start with core tool definitions only
      registry.resetActiveToolsToCore();
      const initialActive = registry.getActiveToolNames();
      expect(initialActive).toHaveLength(6);
      expect(initialActive).toContain("tools_search");

      // 2. Discover filesystem, database, git, github, ci tools
      const searchRes = await router.routeAndExecute(
        "wf_step_1_search",
        "tools_search",
        { query: "database git github ci write" },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(searchRes.result.success).toBe(true);

      // 3. Create a source file in workspace
      const writeCodeRes = await router.routeAndExecute(
        "wf_step_2_write",
        "write_file",
        {
          filePath: "src/calculator.ts",
          content:
            "export function multiply(a: number, b: number): number { return a * b; }\nexport function divide(a: number, b: number): number { if (b === 0) throw new Error('Divide by zero'); return a / b; }",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(writeCodeRes.result.success).toBe(true);

      // 4. Create and run a database migration
      const dbMigrationFile = "migrations/init_metrics.sql";
      await fs.mkdir(path.join(tempWorkspace, "migrations"), { recursive: true });
      await fs.writeFile(
        path.join(tempWorkspace, dbMigrationFile),
        "CREATE TABLE run_metrics (id INTEGER PRIMARY KEY, metric_name TEXT, metric_value REAL);\nINSERT INTO run_metrics (metric_name, metric_value) VALUES ('code_coverage', 98.4);",
        "utf-8",
      );

      const dbMigRes = await router.routeAndExecute(
        "wf_step_3_db_migrate",
        "database_action",
        {
          action: "migrate",
          engine: "sqlite",
          databasePath: "prod_metrics.db",
          migrationPath: dbMigrationFile,
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(dbMigRes.result.success).toBe(true);

      // 5. Query database to confirm migration
      const queryRes = await router.routeAndExecute(
        "wf_step_4_db_query",
        "database_action",
        {
          action: "query",
          engine: "sqlite",
          databasePath: "prod_metrics.db",
          query:
            "SELECT metric_name, metric_value FROM run_metrics WHERE metric_name = 'code_coverage';",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(queryRes.result.success).toBe(true);
      const rows = JSON.parse(queryRes.result.output);
      expect(rows[0].metric_value).toBe(98.4);

      // 6. Execute Git status
      const gitRes = await router.routeAndExecute(
        "wf_step_5_git",
        "execute_git",
        { action: "status" },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(gitRes.result.success).toBe(true);

      // 7. Create GitHub PR using connector
      const prRes = await router.routeAndExecute(
        "wf_step_6_pr",
        "github_service",
        {
          action: "create_pull_request",
          repo: "orbaagent/orbaagent",
          title: "feat(pipeline): autonomous deploy pipeline",
          body: "Validated full automated workflow loop.",
          head: "feat/autonomous-pipeline",
          base: "main",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
          isPreApproved: true,
        },
      );

      expect(prRes.result.success).toBe(true);
      const prData = JSON.parse(prRes.result.output);
      expect(prData.prNumber).toBeDefined();

      // 8. Monitor CI status
      const ciRes = await router.routeAndExecute(
        "wf_step_7_ci",
        "ci_action",
        {
          action: "status",
          repo: "orbaagent/orbaagent",
          branch: "main",
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(ciRes.result.success).toBe(true);

      // 9. Call task_complete
      const completeRes = await router.routeAndExecute(
        "wf_step_8_complete",
        "task_complete",
        {
          summary:
            "Autonomous workflow executed: code written, DB migrated & verified, PR opened, CI monitored.",
          filesModified: ["src/calculator.ts", "migrations/init_metrics.sql", "prod_metrics.db"],
        },
        {
          workspaceDir: tempWorkspace,
          agentRunId: "run_phase3b",
          tenantId: "t-wf",
          userId: "u-wf",
        },
      );

      expect(completeRes.result.success).toBe(true);

      // 10. Audit trail verification: ensure all operations logged with zero credential leakage
      const auditLog = permissionEngine.getAuditLog();
      expect(auditLog.length).toBeGreaterThanOrEqual(8);

      const dbAudits = auditLog.filter((e) => e.toolName === "database_action");
      expect(dbAudits.length).toBeGreaterThanOrEqual(2);

      const prAudits = auditLog.filter((e) => e.toolName === "github_service");
      expect(prAudits.length).toBeGreaterThanOrEqual(1);

      // Verify no sensitive tokens leaked into audit log
      const auditJson = JSON.stringify(auditLog);
      expect(auditJson).not.toContain("super_secret_db_pass_9988!");
      expect(auditJson).not.toContain("stripe_live_sk_88374829374982");
    });
  });
});
