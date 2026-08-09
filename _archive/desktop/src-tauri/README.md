# Desktop persistence contract

The Tauri layer owns the authorized local Project Root and exposes only page-id based operations. Tauri invoke arguments use camelCase.

## Page commands

| Command | Invoke arguments | Result |
| --- | --- | --- |
| `list_pages` | none | `PageSummary[]` |
| `read_page_yaml` | `{ pageId: string }` | `PageDocument` |
| `write_page_yaml` | `{ pageId: string, content: string }` | `PageDocument` (low-level compatibility write) |
| `create_page_yaml` | `{ pageId: string, content: string }` | `PageDocument`; rejects an existing file |
| `reorder_pages` | `{ pageIds: string[] }` | `ProjectSnapshot`; requires every current page exactly once and persists `project.yaml.pageOrder` |
| `delete_page` | `{ pageId: string, baseRevision: number }` | `DeletedPage`; moves the file into `.prototype/trash` |
| `trash_page` | `{ pageId: string }` | `ProjectSnapshot`; Studio compatibility wrapper using the current revision |
| `rename_page` | `{ pageId: string, title: string }` | `PageDocument`; keeps the stable page ID, increments revision and appends revision/audit history |
| `rename_page_id` | `{ pageId: string, newPageId: string, baseRevision: number }` | `PageDocument`; safely changes the file name and `page.id` after a revision check |
| `persist_page_revision` | `{ pageId: string, content: string, revisionRecord: RevisionRecord }` | `PersistedRevision` |

`PageDocument` is `{ pageId, relativePath, content }`. `PageSummary` is `{ id, title, pageType?, status?, revision, relativePath }`. `ProjectSnapshot` is `{ root, manifest, pageIds }`; `pageIds` follows `project.yaml.pageOrder`, then appends newly discovered pages deterministically.

`DeletedPage` is `{ pageId, revision, deleted, recoverable, originalPath, trashPath }`. `PersistedRevision` is `{ page, revision, revisionPath, auditPath }`.

## RevisionRecord JSON

`persist_page_revision` receives a JSON object, not a string. Field names are camelCase:

```ts
interface RevisionRecord {
  id: string;
  pageId: string;
  revision: number;
  source: "manual" | "ai" | "mcp" | "api" | "import" | "undo" | "redo" | "external";
  operator: string;
  baseRevision: number;
  commands: unknown[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedComponentIds: string[];
  createdAt: string;
  revertsRevision?: number;
  reappliesRevision?: number;
}
```

The command rejects path escapes, malformed page IDs, stale `baseRevision`, a non-consecutive revision, page/content identity mismatches, a `before` or `after` snapshot that differs from the YAML documents, and an existing revision file. A successful write atomically replaces `pages/<pageId>.ui.yaml`, writes `.prototype/revisions/<pageId>/<revision padded to six digits>.json`, and appends one entry to `.prototype/audit.jsonl`.

## File watcher

`start_project_watcher` watches `project.yaml`, `requirements/`, `pages/`, `data/`, and `flows/` recursively where applicable. It emits `project-file-changed` after path filtering and a short debounce:

```ts
interface ProjectFileChangedEvent {
  kind: "add" | "change" | "unlink"; // Studio compatibility
  operation: "create" | "change" | "rename" | "delete";
  relativePath: string;
  previousRelativePath?: string;
}
```

Watcher paths are normalized to safe forward-slash relative paths. Events outside the authorized Project Root or outside the five watched inputs are discarded.

## Local MCP lifecycle

`start_local_mcp` launches only the packaged `bin/prototype-mcp`, sets `PROTOTYPE_STUDIO_PROJECT_ROOT` to the active canonical root, and inherits the optional `PROTOTYPE_STUDIO_PREVIEW_URL`. It does not pass unsupported CLI flags. stdin/stdout remain piped so the process owns a live Desktop-managed stdio session; an immediate process exit is returned as `stopped`, never as `running`. `McpStatus.detail` identifies a running process as a Desktop-managed session.
