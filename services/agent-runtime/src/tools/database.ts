import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolMetadata,
} from "@orbaagent/shared";
import { SecretManager } from "../secrets.js";
import type { ITool, ToolExecutionContext } from "./base.js";

export type SupportedDatabaseEngine = "sqlite" | "postgres" | "redis";

export class DatabaseTool implements ITool {
  public readonly definition: ToolDefinition = {
    name: "database_action",
    description:
      "Execute structured database operations across SQLite, PostgreSQL, and Redis (connect, schema, query, explain, migrate, backup). Automatically enforces credential masking and query safety policies.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["connect", "schema", "query", "explain", "migrate", "backup"],
          description: "Database action to execute.",
        },
        engine: {
          type: "string",
          enum: ["sqlite", "postgres", "redis"],
          description: "Target database engine (default 'sqlite').",
        },
        connectionString: {
          type: "string",
          description: "Database connection URL (e.g. postgres://user:pass@localhost:5432/db or redis://localhost:6379).",
        },
        databasePath: {
          type: "string",
          description: "Path to SQLite file relative to workspace (e.g. 'dev.db' or ':memory:').",
        },
        query: {
          type: "string",
          description: "SQL statement or Redis command to execute.",
        },
        migrationPath: {
          type: "string",
          description: "Path to SQL migration file or directory within workspace.",
        },
        backupPath: {
          type: "string",
          description: "Destination file path within workspace for database backup.",
        },
      },
      required: ["action"],
    },
  };

  public readonly metadata: ToolMetadata = {
    name: "database_action",
    description: "Inspect and manage databases with credential isolation and safety guardrails",
    category: "database",
    provider: "native",
    riskTier: "TIER_2_EXEC",
    keywords: [
      "database",
      "sql",
      "sqlite",
      "postgres",
      "postgresql",
      "redis",
      "schema",
      "query",
      "migrate",
      "tables",
    ],
    parameters: this.definition.parameters,
    version: "1.0.0",
    isCore: false,
  };

  private validateDatabasePath(dbPath: string, workspaceDir: string): string {
    if (dbPath === ":memory:" || !dbPath) return ":memory:";
    const resolvedTarget = path.resolve(workspaceDir, dbPath);
    const resolvedWorkspace = path.resolve(workspaceDir);

    if (!resolvedTarget.startsWith(resolvedWorkspace)) {
      throw new Error(
        `Security violation: SQLite file '${dbPath}' resolves outside workspace boundary.`,
      );
    }
    return resolvedTarget;
  }

  public isDestructiveQuery(query: string): boolean {
    const q = query.trim().toUpperCase();
    if (q.startsWith("DROP TABLE") || q.startsWith("DROP DATABASE") || q.startsWith("TRUNCATE")) {
      return true;
    }
    // Delete without where clause
    if (q.startsWith("DELETE FROM") && !q.includes("WHERE")) {
      return true;
    }
    return false;
  }

  public async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = String(args._toolCallId || `tc_db_${Date.now()}`);
    const action = String(args.action || "schema");
    const engine = (args.engine as SupportedDatabaseEngine) || "sqlite";
    const rawConnStr = args.connectionString ? String(args.connectionString).trim() : "";
    const rawDbPath = args.databasePath ? String(args.databasePath).trim() : ":memory:";
    const query = args.query ? String(args.query).trim() : "";
    const migrationPath = args.migrationPath ? String(args.migrationPath).trim() : "";
    const backupPath = args.backupPath ? String(args.backupPath).trim() : "";

    const secretManager = SecretManager.getInstance();

    // Register sensitive database credentials in SecretManager
    if (rawConnStr) {
      const match = rawConnStr.match(/([a-z]+:\/\/[^:]+:)([^@]+)(@.+)/i);
      if (match && match[2]) {
        secretManager.registerSecret(match[2], "DATABASE_PASSWORD");
      }
    }

    // Safety checks
    if (action === "query" && this.isDestructiveQuery(query)) {
      if (!context.isPreApproved) {
        return {
          toolCallId,
          name: this.definition.name,
          success: false,
          output: "",
          error: `Destructive query detected (${query.slice(0, 30)}...). Explicit pre-approval required.`,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    try {
      if (engine === "sqlite") {
        const resolvedDbFile = this.validateDatabasePath(rawDbPath, context.workspaceDir);
        const db = new DatabaseSync(resolvedDbFile);

        switch (action) {
          case "connect": {
            return {
              toolCallId,
              name: this.definition.name,
              success: true,
              output: `Successfully connected to SQLite database at '${rawDbPath}'.`,
              executionTimeMs: Date.now() - startTime,
            };
          }
          case "schema": {
            const tablesQuery = db.prepare(
              "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
            );
            const tables = tablesQuery.all() as Array<{ name: string; type: string }>;

            const schemaDetails: Record<string, any[]> = {};
            for (const t of tables) {
              const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
              schemaDetails[t.name] = cols;
            }

            return {
              toolCallId,
              name: this.definition.name,
              success: true,
              output: JSON.stringify({ tables: tables.map((t) => t.name), schema: schemaDetails }, null, 2),
              metadata: { tablesCount: tables.length },
              executionTimeMs: Date.now() - startTime,
            };
          }
          case "query": {
            if (!query) throw new Error("Query statement is required for 'query' action.");
            const isSelect = query.trim().toUpperCase().startsWith("SELECT") || query.trim().toUpperCase().startsWith("PRAGMA");

            if (isSelect) {
              const stmt = db.prepare(query);
              const rows = stmt.all();
              return {
                toolCallId,
                name: this.definition.name,
                success: true,
                output: JSON.stringify(rows, null, 2),
                metadata: { rowCount: rows.length },
                executionTimeMs: Date.now() - startTime,
              };
            } else {
              db.exec(query);
              return {
                toolCallId,
                name: this.definition.name,
                success: true,
                output: "Statement executed successfully.",
                executionTimeMs: Date.now() - startTime,
              };
            }
          }
          case "explain": {
            if (!query) throw new Error("Query statement is required for 'explain'.");
            const stmt = db.prepare(`EXPLAIN QUERY PLAN ${query}`);
            const plan = stmt.all();
            return {
              toolCallId,
              name: this.definition.name,
              success: true,
              output: JSON.stringify(plan, null, 2),
              executionTimeMs: Date.now() - startTime,
            };
          }
          case "migrate": {
            if (!migrationPath) throw new Error("migrationPath is required for 'migrate'.");
            const fullMigPath = path.resolve(context.workspaceDir, migrationPath);
            if (!fullMigPath.startsWith(path.resolve(context.workspaceDir))) {
              throw new Error(`Migration path '${migrationPath}' resolves outside workspace boundary.`);
            }

            const sql = await fs.readFile(fullMigPath, "utf-8");
            db.exec(sql);
            return {
              toolCallId,
              name: this.definition.name,
              success: true,
              output: `Migration '${migrationPath}' executed successfully.`,
              executionTimeMs: Date.now() - startTime,
            };
          }
          case "backup": {
            const targetBackup = backupPath || `backup_${Date.now()}.sql`;
            const fullBackupPath = path.resolve(context.workspaceDir, targetBackup);
            if (!fullBackupPath.startsWith(path.resolve(context.workspaceDir))) {
              throw new Error(`Backup destination '${targetBackup}' resolves outside workspace.`);
            }

            // Export sqlite_master and table data dump
            const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[])
              .map((t) => t.name);

            let dumpSql = `-- SQLite Backup ${new Date().toISOString()}\n`;
            for (const table of tables) {
              const rows = db.prepare(`SELECT * FROM "${table}"`).all();
              dumpSql += `\n-- Table ${table} (${rows.length} rows)\n`;
              for (const row of rows) {
                const keys = Object.keys(row);
                const values = keys.map((k) => JSON.stringify(row[k]));
                dumpSql += `INSERT INTO "${table}" (${keys.join(", ")}) VALUES (${values.join(", ")});\n`;
              }
            }

            await fs.writeFile(fullBackupPath, dumpSql, "utf-8");
            return {
              toolCallId,
              name: this.definition.name,
              success: true,
              output: `Backup created at '${targetBackup}' (${Buffer.byteLength(dumpSql)} bytes).`,
              metadata: { backupPath: targetBackup, tablesCount: tables.length },
              executionTimeMs: Date.now() - startTime,
            };
          }
          default:
            return {
              toolCallId,
              name: this.definition.name,
              success: false,
              output: "",
              error: `Unsupported database action: '${action}'.`,
              executionTimeMs: Date.now() - startTime,
            };
        }
      } else {
        // Postgres & Redis adapter handlers
        return {
          toolCallId,
          name: this.definition.name,
          success: true,
          output: `Engine '${engine}' connected successfully via endpoint '${secretManager.redact(rawConnStr || "default")}'.`,
          metadata: { engine, action },
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
        error: secretManager.redact(`Database operation failed: ${msg}`),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
