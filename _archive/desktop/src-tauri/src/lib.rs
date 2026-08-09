use chrono::{SecondsFormat, Utc};
use notify::{event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const DSL_VERSION: &str = "1.0";
const RENDERER_VERSION: &str = "0.1.0";
const DESIGN_SYSTEM_VERSION: &str = "0.1.0";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_PAGE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_REVISION: u64 = 999_999;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(180);
const WATCHED_DIRECTORIES: &[&str] = &["requirements", "pages", "data", "flows"];
const PROJECT_DIRECTORIES: &[&str] = &[
    "requirements",
    "pages",
    "data",
    "flows",
    "assets",
    ".prototype",
    ".prototype/revisions",
    ".prototype/cache",
];

type CommandResult<T> = Result<T, CommandError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandError {
    code: &'static str,
    message: String,
}

impl CommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(action: &str, error: std::io::Error) -> Self {
        Self::new("IO_ERROR", format!("{action}: {error}"))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectManifest {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    status: String,
    dsl_version: String,
    renderer_version: String,
    design_system_version: String,
    created_at: String,
    updated_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    page_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshot {
    root: String,
    manifest: ProjectManifest,
    page_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectInput {
    name: String,
    description: Option<String>,
    directory_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageEnvelope {
    dsl_version: String,
    revision: u64,
    page: PageIdentity,
}

#[derive(Debug, Deserialize)]
struct PageIdentity {
    id: String,
    title: String,
    #[serde(rename = "type")]
    page_type: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageDocument {
    page_id: String,
    relative_path: String,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageSummary {
    id: String,
    title: String,
    page_type: Option<String>,
    status: Option<String>,
    revision: u64,
    relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletedPage {
    page_id: String,
    revision: u64,
    deleted: bool,
    recoverable: bool,
    original_path: String,
    trash_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedRevision {
    page: PageDocument,
    revision: u64,
    revision_path: String,
    audit_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionRecordInput {
    id: String,
    page_id: String,
    revision: u64,
    source: String,
    operator: String,
    base_revision: u64,
    commands: serde_json::Value,
    before: serde_json::Value,
    after: serde_json::Value,
    changed_component_ids: Vec<String>,
    created_at: String,
    reverts_revision: Option<u64>,
    reapplies_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileEvent {
    kind: String,
    operation: String,
    relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpStatus {
    state: String,
    project_root: Option<String>,
    pid: Option<u32>,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpConnectionInfo {
    state: String,
    project_root: Option<String>,
    sidecar_path: Option<String>,
    sidecar_available: bool,
    config_toml: Option<String>,
    connect_prompt: Option<String>,
    detail: Option<String>,
}

#[derive(Default)]
struct McpRuntime {
    child: Option<Child>,
    project_root: Option<PathBuf>,
}

impl McpRuntime {
    fn stop(&mut self) -> CommandResult<()> {
        if let Some(mut child) = self.child.take() {
            let is_running = child
                .try_wait()
                .map_err(|error| CommandError::io("无法检查 Local MCP 状态", error))?
                .is_none();
            if is_running {
                child
                    .kill()
                    .map_err(|error| CommandError::io("Local MCP 进程无法停止", error))?;
            }
            let _ = child.wait();
        }
        self.project_root = None;
        Ok(())
    }
}

impl Drop for McpRuntime {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[derive(Default)]
struct DesktopState {
    project_root: Mutex<Option<PathBuf>>,
    mcp: Mutex<McpRuntime>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    persistence: Mutex<()>,
}

fn lock_error(name: &str) -> CommandError {
    CommandError::new("STATE_UNAVAILABLE", format!("无法访问 {name} 状态。"))
}

fn canonical_directory(path: &Path) -> CommandResult<PathBuf> {
    let canonical =
        fs::canonicalize(path).map_err(|error| CommandError::io("无法打开所选目录", error))?;
    let metadata =
        fs::metadata(&canonical).map_err(|error| CommandError::io("无法读取所选目录", error))?;
    if !metadata.is_dir() {
        return Err(CommandError::new("NOT_A_DIRECTORY", "所选路径不是目录。"));
    }
    Ok(canonical)
}

fn active_root(state: &DesktopState) -> CommandResult<PathBuf> {
    state
        .project_root
        .lock()
        .map_err(|_| lock_error("当前项目"))?
        .clone()
        .ok_or_else(|| {
            CommandError::new(
                "NO_ACTIVE_PROJECT",
                "请先选择或创建一个 Prototype Studio 项目。",
            )
        })
}

fn ensure_within_root(root: &Path, candidate: &Path) -> CommandResult<PathBuf> {
    let canonical = fs::canonicalize(candidate)
        .map_err(|error| CommandError::io("无法解析项目文件路径", error))?;
    if canonical != root && !canonical.starts_with(root) {
        return Err(CommandError::new(
            "PATH_OUTSIDE_PROJECT",
            "拒绝访问 Project Root 之外的路径。",
        ));
    }
    Ok(canonical)
}

fn checked_manifest_path(root: &Path) -> CommandResult<PathBuf> {
    ensure_within_root(root, &root.join("project.yaml"))
}

fn validate_page_id(page_id: &str) -> CommandResult<()> {
    let mut chars = page_id.chars();
    let valid_first = chars
        .next()
        .map(|character| character.is_ascii_alphabetic())
        .unwrap_or(false);
    let valid_rest = chars
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-');
    if !valid_first || !valid_rest || page_id.len() > 128 {
        return Err(CommandError::new(
            "INVALID_PAGE_ID",
            "页面 ID 必须以英文字母开头，且只能包含英文字母、数字、下划线或连字符。",
        ));
    }
    Ok(())
}

fn checked_pages_directory(root: &Path) -> CommandResult<PathBuf> {
    let pages = ensure_within_root(root, &root.join("pages"))?;
    if !pages.is_dir() {
        return Err(CommandError::new("INVALID_PROJECT", "pages 不是有效目录。"));
    }
    Ok(pages)
}

fn checked_existing_page_path(root: &Path, page_id: &str) -> CommandResult<PathBuf> {
    validate_page_id(page_id)?;
    let pages = checked_pages_directory(root)?;
    let candidate = pages.join(format!("{page_id}.ui.yaml"));
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|error| CommandError::io("无法读取页面文件", error))?;
    if metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            "PATH_OUTSIDE_PROJECT",
            "拒绝读写符号链接形式的页面文件。",
        ));
    }
    let page = ensure_within_root(root, &candidate)?;
    if page.parent() != Some(pages.as_path()) {
        return Err(CommandError::new(
            "PATH_OUTSIDE_PROJECT",
            "页面文件必须直接位于 pages 目录。",
        ));
    }
    Ok(page)
}

fn checked_page_write_path(root: &Path, page_id: &str) -> CommandResult<PathBuf> {
    validate_page_id(page_id)?;
    let pages = checked_pages_directory(root)?;
    let target = pages.join(format!("{page_id}.ui.yaml"));
    if fs::symlink_metadata(&target).is_ok() {
        let existing = ensure_within_root(root, &target)?;
        if existing.parent() != Some(pages.as_path()) {
            return Err(CommandError::new(
                "PATH_OUTSIDE_PROJECT",
                "拒绝写入指向 pages 目录之外的符号链接。",
            ));
        }
    }
    Ok(target)
}

fn checked_safe_directory(root: &Path, relative: &Path, create: bool) -> CommandResult<PathBuf> {
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(CommandError::new(
            "INVALID_PATH",
            "项目内部目录必须是安全的相对路径。",
        ));
    }

    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            unreachable!("relative path components were validated")
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(CommandError::new(
                        "PATH_OUTSIDE_PROJECT",
                        "拒绝通过项目内部的符号链接目录写入文件。",
                    ));
                }
                if !metadata.is_dir() {
                    return Err(CommandError::new(
                        "INVALID_PROJECT",
                        "项目内部目录路径被普通文件占用。",
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                fs::create_dir(&current)
                    .map_err(|error| CommandError::io("无法创建项目内部目录", error))?;
            }
            Err(error) => return Err(CommandError::io("无法检查项目内部目录", error)),
        }
    }
    ensure_within_root(root, &current)
}

fn parse_page_document(page_id: &str, content: &str) -> CommandResult<PageEnvelope> {
    let parsed: PageEnvelope = serde_yaml::from_str(content).map_err(|error| {
        CommandError::new("INVALID_PAGE_DSL", format!("页面 YAML 无法解析: {error}"))
    })?;
    if parsed.page.id != page_id || parsed.dsl_version.trim().is_empty() {
        return Err(CommandError::new(
            "PAGE_ID_MISMATCH",
            "页面 YAML 的 page.id 必须与请求的 pageId 一致。",
        ));
    }
    Ok(parsed)
}

fn read_page_envelope(
    root: &Path,
    page_id: &str,
) -> CommandResult<(PathBuf, String, PageEnvelope)> {
    let path = checked_existing_page_path(root, page_id)?;
    let content = read_limited(&path, MAX_PAGE_BYTES)?;
    let parsed = parse_page_document(page_id, &content)?;
    Ok((path, content, parsed))
}

fn read_limited(path: &Path, maximum_bytes: u64) -> CommandResult<String> {
    let metadata =
        fs::metadata(path).map_err(|error| CommandError::io("无法读取文件信息", error))?;
    if !metadata.is_file() {
        return Err(CommandError::new("NOT_A_FILE", "目标路径不是普通文件。"));
    }
    if metadata.len() > maximum_bytes {
        return Err(CommandError::new(
            "FILE_TOO_LARGE",
            "文件超过桌面端允许的大小。",
        ));
    }
    fs::read_to_string(path).map_err(|error| CommandError::io("无法读取 UTF-8 文件", error))
}

fn parse_manifest(content: &str) -> CommandResult<ProjectManifest> {
    let manifest: ProjectManifest = serde_yaml::from_str(content).map_err(|error| {
        CommandError::new("INVALID_PROJECT", format!("project.yaml 无法解析: {error}"))
    })?;
    if manifest.id.trim().is_empty()
        || manifest.name.trim().is_empty()
        || manifest.dsl_version.trim().is_empty()
    {
        return Err(CommandError::new(
            "INVALID_PROJECT",
            "project.yaml 缺少 id、name 或 dslVersion。",
        ));
    }
    Ok(manifest)
}

fn list_page_ids(root: &Path) -> CommandResult<Vec<String>> {
    let pages = checked_pages_directory(root)?;
    let mut ids = Vec::new();
    for entry in
        fs::read_dir(pages).map_err(|error| CommandError::io("无法扫描 pages 目录", error))?
    {
        let entry = entry.map_err(|error| CommandError::io("无法读取 pages 条目", error))?;
        if !entry
            .file_type()
            .map_err(|error| CommandError::io("无法读取页面文件类型", error))?
            .is_file()
        {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(page_id) = name.strip_suffix(".ui.yaml") {
            if validate_page_id(page_id).is_ok() {
                ids.push(page_id.to_owned());
            }
        }
    }
    ids.sort();
    Ok(ids)
}

fn list_pages_inner(root: &Path) -> CommandResult<Vec<PageSummary>> {
    let mut pages = Vec::new();
    for page_id in list_page_ids(root)? {
        let (_, _, parsed) = read_page_envelope(root, &page_id)?;
        pages.push(PageSummary {
            id: page_id.clone(),
            title: parsed.page.title,
            page_type: parsed.page.page_type,
            status: parsed.page.status,
            revision: parsed.revision,
            relative_path: format!("pages/{page_id}.ui.yaml"),
        });
    }
    Ok(pages)
}

fn ordered_page_ids(manifest: &ProjectManifest, discovered: Vec<String>) -> Vec<String> {
    let discovered_set = discovered
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut ordered = manifest
        .page_order
        .iter()
        .filter(|page_id| {
            discovered_set.contains(page_id.as_str()) && seen.insert((*page_id).clone())
        })
        .cloned()
        .collect::<Vec<_>>();
    ordered.extend(
        discovered
            .into_iter()
            .filter(|page_id| seen.insert(page_id.clone())),
    );
    ordered
}

fn write_manifest(root: &Path, manifest: &ProjectManifest) -> CommandResult<()> {
    let content = serde_yaml::to_string(manifest).map_err(|error| {
        CommandError::new("SERIALIZE_ERROR", format!("无法生成 project.yaml: {error}"))
    })?;
    atomic_write(&checked_manifest_path(root)?, &content)
}

fn update_manifest_page_order(
    root: &Path,
    update: impl FnOnce(&mut Vec<String>),
) -> CommandResult<()> {
    let path = checked_manifest_path(root)?;
    let content = read_limited(&path, MAX_MANIFEST_BYTES)?;
    let mut manifest = parse_manifest(&content)?;
    update(&mut manifest.page_order);
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    write_manifest(root, &manifest)
}

fn project_snapshot(root: &Path) -> CommandResult<ProjectSnapshot> {
    let manifest_path = checked_manifest_path(root)?;
    let content = read_limited(&manifest_path, MAX_MANIFEST_BYTES)?;
    let manifest = parse_manifest(&content)?;
    let page_ids = ordered_page_ids(&manifest, list_page_ids(root)?);
    Ok(ProjectSnapshot {
        root: root.to_string_lossy().into_owned(),
        manifest,
        page_ids,
    })
}

fn ensure_board_file(root: &Path) -> CommandResult<()> {
    let board_path = ensure_within_root(root, &root.join("board.yaml"))?;
    if fs::symlink_metadata(&board_path).is_ok() {
        return Ok(());
    }
    let page_ids = list_page_ids(root)?;
    let manifest = parse_manifest(&read_limited(&checked_manifest_path(root)?, MAX_MANIFEST_BYTES)?)?;
    let objects: Vec<serde_json::Value> = page_ids
        .iter()
        .enumerate()
        .map(|(index, page_id)| {
            serde_json::json!({
                "id": format!("obj-{page_id}"),
                "type": "page",
                "pageId": page_id,
                "x": 120,
                "y": 80 + index as i64 * 720,
                "width": 960,
                "height": 640,
                "source": "default"
            })
        })
        .collect();
    let board = serde_json::json!({
        "dslVersion": DSL_VERSION,
        "id": format!("{}-board", manifest.id),
        "revision": 1,
        "objects": objects,
        "links": []
    });
    let content = serde_yaml::to_string(&board)
        .map_err(|error| CommandError::new("SERIALIZE_ERROR", format!("无法生成 board.yaml: {error}")))?;
    atomic_write(&board_path, &content)
}

fn stop_project_services(state: &DesktopState) -> CommandResult<()> {
    state
        .watcher
        .lock()
        .map_err(|_| lock_error("文件监听"))?
        .take();
    state
        .mcp
        .lock()
        .map_err(|_| lock_error("Local MCP"))?
        .stop()
}

fn activate_project(state: &DesktopState, root: PathBuf) -> CommandResult<()> {
    stop_project_services(state)?;
    *state
        .project_root
        .lock()
        .map_err(|_| lock_error("当前项目"))? = Some(root);
    Ok(())
}

fn open_project_inner(state: &DesktopState, path: &Path) -> CommandResult<ProjectSnapshot> {
    let root = canonical_directory(path)?;
    let snapshot = project_snapshot(&root)?;
    ensure_board_file(&root)?;
    activate_project(state, root)?;
    Ok(snapshot)
}

fn safe_directory_name(input: &str) -> CommandResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." || trimmed.len() > 128 {
        return Err(CommandError::new(
            "INVALID_DIRECTORY_NAME",
            "项目目录名无效。",
        ));
    }
    if Path::new(trimmed).components().count() != 1
        || Path::new(trimmed)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(CommandError::new(
            "INVALID_DIRECTORY_NAME",
            "项目目录名不能包含路径分隔符或父级路径。",
        ));
    }
    Ok(trimmed.to_owned())
}

fn default_directory_name(name: &str) -> String {
    let mut result = String::new();
    let mut previous_dash = false;
    for character in name.trim().chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            result.push(character);
            previous_dash = false;
        } else if !previous_dash && !result.is_empty() {
            result.push('-');
            previous_dash = true;
        }
    }
    let result = result.trim_matches('-');
    if result.is_empty() {
        format!(
            "prototype-project-{}",
            &Uuid::new_v4().simple().to_string()[..8]
        )
    } else {
        result.chars().take(80).collect()
    }
}

fn atomic_write(path: &Path, content: &str) -> CommandResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::new("INVALID_PATH", "写入目标没有父目录。"))?;
    let temporary = parent.join(format!(".prototype-write-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| CommandError::io("无法创建临时文件", error))?;
    if let Err(error) = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::io("无法写入临时文件", error));
    }
    drop(file);

    if let Err(error) = fs::rename(&temporary, path) {
        #[cfg(target_os = "windows")]
        {
            if path.exists() {
                fs::remove_file(path)
                    .map_err(|remove_error| CommandError::io("无法替换页面文件", remove_error))?;
                fs::rename(&temporary, path)
                    .map_err(|rename_error| CommandError::io("无法保存页面文件", rename_error))?;
            } else {
                let _ = fs::remove_file(&temporary);
                return Err(CommandError::io("无法保存文件", error));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = fs::remove_file(&temporary);
            return Err(CommandError::io("无法保存文件", error));
        }
    }
    Ok(())
}

fn rewrite_page_identity(
    content: &str,
    expected_page_id: &str,
    new_page_id: Option<&str>,
    new_title: Option<&str>,
) -> CommandResult<String> {
    let mut document: serde_yaml::Value = serde_yaml::from_str(content).map_err(|error| {
        CommandError::new("INVALID_PAGE_DSL", format!("页面 YAML 无法解析: {error}"))
    })?;
    let root = document
        .as_mapping_mut()
        .ok_or_else(|| CommandError::new("INVALID_PAGE_DSL", "页面 YAML 根节点必须是对象。"))?;
    let page = root
        .get_mut(serde_yaml::Value::String("page".to_owned()))
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| CommandError::new("INVALID_PAGE_DSL", "页面 YAML 缺少 page 对象。"))?;
    let id_key = serde_yaml::Value::String("id".to_owned());
    let actual_page_id = page.get(&id_key).and_then(serde_yaml::Value::as_str);
    if actual_page_id != Some(expected_page_id) {
        return Err(CommandError::new(
            "PAGE_ID_MISMATCH",
            "页面 YAML 的 page.id 与页面文件名不一致。",
        ));
    }
    if let Some(new_page_id) = new_page_id {
        validate_page_id(new_page_id)?;
        page.insert(id_key, serde_yaml::Value::String(new_page_id.to_owned()));
    }
    if let Some(new_title) = new_title {
        let title = new_title.trim();
        if title.is_empty() || title.chars().count() > 256 {
            return Err(CommandError::new(
                "INVALID_PAGE_TITLE",
                "页面标题不能为空且不能超过 256 个字符。",
            ));
        }
        page.insert(
            serde_yaml::Value::String("title".to_owned()),
            serde_yaml::Value::String(title.to_owned()),
        );
    }
    serde_yaml::to_string(&document).map_err(|error| {
        CommandError::new("SERIALIZE_ERROR", format!("无法生成页面 YAML: {error}"))
    })
}

fn rewrite_page_revision(content: &str, expected: u64, next: u64) -> CommandResult<String> {
    let mut document: serde_yaml::Value = serde_yaml::from_str(content).map_err(|error| {
        CommandError::new("INVALID_PAGE_DSL", format!("页面 YAML 无法解析: {error}"))
    })?;
    let root = document
        .as_mapping_mut()
        .ok_or_else(|| CommandError::new("INVALID_PAGE_DSL", "页面 YAML 根节点必须是对象。"))?;
    let revision_key = serde_yaml::Value::String("revision".to_owned());
    if root.get(&revision_key).and_then(serde_yaml::Value::as_u64) != Some(expected) {
        return Err(CommandError::new(
            "REVISION_CONFLICT",
            "页面 YAML 的 revision 与当前页面不一致。",
        ));
    }
    root.insert(
        revision_key,
        serde_yaml::Value::Number(serde_yaml::Number::from(next)),
    );
    serde_yaml::to_string(&document).map_err(|error| {
        CommandError::new("SERIALIZE_ERROR", format!("无法生成页面 YAML: {error}"))
    })
}

fn yaml_as_json(content: &str) -> CommandResult<serde_json::Value> {
    serde_yaml::from_str(content).map_err(|error| {
        CommandError::new(
            "INVALID_PAGE_DSL",
            format!("页面 YAML 无法转换为 Revision 文档: {error}"),
        )
    })
}

fn validate_revision_record(
    page_id: &str,
    current_content: &str,
    current_revision: u64,
    next_content: &str,
    next_revision: u64,
    raw_record: &serde_json::Value,
) -> CommandResult<RevisionRecordInput> {
    let record: RevisionRecordInput =
        serde_json::from_value(raw_record.clone()).map_err(|error| {
            CommandError::new(
                "INVALID_REVISION_RECORD",
                format!("RevisionRecord JSON 缺少必填字段或类型错误: {error}"),
            )
        })?;
    if record.id.trim().is_empty()
        || record.operator.trim().is_empty()
        || record.created_at.trim().is_empty()
        || !record.commands.is_array()
        || !matches!(
            record.source.as_str(),
            "manual" | "ai" | "mcp" | "api" | "import" | "undo" | "redo" | "external"
        )
    {
        return Err(CommandError::new(
            "INVALID_REVISION_RECORD",
            "RevisionRecord 的 id、source、operator、commands 或 createdAt 无效。",
        ));
    }
    if record.page_id != page_id {
        return Err(CommandError::new(
            "PAGE_ID_MISMATCH",
            "RevisionRecord.pageId 必须与请求的 pageId 一致。",
        ));
    }
    if record.base_revision != current_revision {
        return Err(CommandError::new(
            "REVISION_CONFLICT",
            format!(
                "页面当前 revision 为 {current_revision}，但保存基于 {}。请重新读取页面。",
                record.base_revision
            ),
        ));
    }
    if record.revision == 0
        || record.revision > MAX_REVISION
        || record.revision != next_revision
        || record.base_revision.checked_add(1) != Some(record.revision)
    {
        return Err(CommandError::new(
            "INVALID_REVISION_RECORD",
            "RevisionRecord.revision 必须是 baseRevision + 1，且不得超过 999999。",
        ));
    }
    let current_json = yaml_as_json(current_content)?;
    let next_json = yaml_as_json(next_content)?;
    if record.before != current_json || record.after != next_json {
        return Err(CommandError::new(
            "REVISION_CONTENT_MISMATCH",
            "RevisionRecord.before/after 必须与当前页面和待保存 YAML 完全一致。",
        ));
    }
    Ok(record)
}

fn append_audit(root: &Path, record: &RevisionRecordInput) -> CommandResult<()> {
    let prototype = checked_safe_directory(root, Path::new(".prototype"), true)?;
    let audit_path = prototype.join("audit.jsonl");
    if fs::symlink_metadata(&audit_path)
        .map(|metadata| metadata.file_type().is_symlink() || !metadata.is_file())
        .unwrap_or(false)
    {
        return Err(CommandError::new(
            "INVALID_AUDIT_FILE",
            "audit.jsonl 必须是项目内部的普通文件。",
        ));
    }
    let line = serde_json::to_string(&serde_json::json!({
        "revisionId": record.id,
        "pageId": record.page_id,
        "revision": record.revision,
        "source": record.source,
        "operator": record.operator,
        "changedComponentIds": record.changed_component_ids,
        "createdAt": record.created_at,
        "revertsRevision": record.reverts_revision,
        "reappliesRevision": record.reapplies_revision,
    }))
    .map_err(|error| CommandError::new("SERIALIZE_ERROR", format!("无法生成审计记录: {error}")))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .map_err(|error| CommandError::io("无法打开 audit.jsonl", error))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|error| CommandError::io("无法追加审计记录", error))
}

fn persist_revision_inner(
    root: &Path,
    page_id: &str,
    content: &str,
    raw_record: &serde_json::Value,
) -> CommandResult<PersistedRevision> {
    if content.len() as u64 > MAX_PAGE_BYTES {
        return Err(CommandError::new(
            "FILE_TOO_LARGE",
            "页面 YAML 超过 16 MiB 限制。",
        ));
    }
    let (_, current_content, current) = read_page_envelope(root, page_id)?;
    let next = parse_page_document(page_id, content)?;
    let record = validate_revision_record(
        page_id,
        &current_content,
        current.revision,
        content,
        next.revision,
        raw_record,
    )?;
    if record.base_revision != current.revision {
        return Err(CommandError::new(
            "REVISION_CONFLICT",
            format!(
                "页面当前 revision 为 {}，但保存基于 {}。请重新读取页面。",
                current.revision, record.base_revision
            ),
        ));
    }

    let revision_directory = checked_safe_directory(
        root,
        &PathBuf::from(".prototype/revisions").join(page_id),
        true,
    )?;
    let revision_name = format!("{:06}.json", record.revision);
    let revision_path = revision_directory.join(&revision_name);
    if fs::symlink_metadata(&revision_path).is_ok() {
        return Err(CommandError::new(
            "REVISION_EXISTS",
            format!("Revision {} 已存在，不得覆盖。", record.revision),
        ));
    }
    let revision_json = serde_json::to_string_pretty(raw_record).map_err(|error| {
        CommandError::new(
            "SERIALIZE_ERROR",
            format!("无法序列化 RevisionRecord: {error}"),
        )
    })?;
    let page_path = checked_existing_page_path(root, page_id)?;
    atomic_write(&page_path, content)?;
    if let Err(error) = atomic_write(&revision_path, &revision_json) {
        let _ = atomic_write(&page_path, &current_content);
        return Err(error);
    }
    if let Err(error) = append_audit(root, &record) {
        let _ = atomic_write(&page_path, &current_content);
        let _ = fs::remove_file(&revision_path);
        return Err(error);
    }
    Ok(PersistedRevision {
        page: PageDocument {
            page_id: page_id.to_owned(),
            relative_path: format!("pages/{page_id}.ui.yaml"),
            content: content.to_owned(),
        },
        revision: record.revision,
        revision_path: format!(".prototype/revisions/{page_id}/{revision_name}"),
        audit_path: ".prototype/audit.jsonl".to_owned(),
    })
}

#[tauri::command]
async fn select_project_folder(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<Option<ProjectSnapshot>> {
    let selected = app.dialog().file().blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| {
        CommandError::new(
            "INVALID_SELECTION",
            format!("所选目录不是本地文件系统路径: {error}"),
        )
    })?;
    open_project_inner(&state, &path).map(Some)
}

#[tauri::command]
fn open_project_folder(
    path: String,
    state: State<'_, DesktopState>,
) -> CommandResult<ProjectSnapshot> {
    open_project_inner(&state, Path::new(&path))
}

#[tauri::command]
async fn create_project(
    app: tauri::AppHandle,
    input: CreateProjectInput,
    state: State<'_, DesktopState>,
) -> CommandResult<Option<ProjectSnapshot>> {
    if input.name.trim().is_empty() {
        return Err(CommandError::new(
            "INVALID_PROJECT_NAME",
            "项目名称不能为空。",
        ));
    }
    let selected_parent = app.dialog().file().blocking_pick_folder();
    let Some(selected_parent) = selected_parent else {
        return Ok(None);
    };
    let selected_parent = selected_parent.into_path().map_err(|error| {
        CommandError::new(
            "INVALID_SELECTION",
            format!("所选目录不是本地文件系统路径: {error}"),
        )
    })?;
    let parent = canonical_directory(&selected_parent)?;
    let directory_name = safe_directory_name(
        &input
            .directory_name
            .unwrap_or_else(|| default_directory_name(&input.name)),
    )?;
    let root = parent.join(directory_name);

    if root.exists() {
        let metadata = fs::symlink_metadata(&root)
            .map_err(|error| CommandError::io("无法检查目标目录", error))?;
        if metadata.file_type().is_symlink() {
            return Err(CommandError::new(
                "TARGET_IS_SYMLINK",
                "为避免越出用户选择的父目录，不能在符号链接中创建项目。",
            ));
        }
        let is_empty = fs::read_dir(&root)
            .map_err(|error| CommandError::io("无法检查目标目录", error))?
            .next()
            .is_none();
        if !is_empty {
            return Err(CommandError::new(
                "TARGET_NOT_EMPTY",
                "目标目录已存在且不为空，请选择其他项目目录名。",
            ));
        }
    } else {
        fs::create_dir(&root).map_err(|error| CommandError::io("无法创建项目目录", error))?;
    }

    let root = canonical_directory(&root)?;
    if root.parent() != Some(parent.as_path()) {
        return Err(CommandError::new(
            "PATH_OUTSIDE_SELECTION",
            "新项目必须直接位于用户选择的父目录中。",
        ));
    }
    for relative in PROJECT_DIRECTORIES {
        fs::create_dir_all(root.join(relative))
            .map_err(|error| CommandError::io("无法创建项目结构", error))?;
    }

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let manifest = ProjectManifest {
        id: Uuid::new_v4().to_string(),
        name: input.name.trim().to_owned(),
        description: input.description.filter(|value| !value.trim().is_empty()),
        status: "active".to_owned(),
        dsl_version: DSL_VERSION.to_owned(),
        renderer_version: RENDERER_VERSION.to_owned(),
        design_system_version: DESIGN_SYSTEM_VERSION.to_owned(),
        created_at: now.clone(),
        updated_at: now.clone(),
        page_order: Vec::new(),
    };
    let yaml = serde_yaml::to_string(&manifest).map_err(|error| {
        CommandError::new("SERIALIZE_ERROR", format!("无法生成 project.yaml: {error}"))
    })?;
    atomic_write(&root.join("project.yaml"), &yaml)?;
    let board = serde_json::json!({
        "dslVersion": DSL_VERSION,
        "id": format!("{}-board", manifest.id),
        "revision": 1,
        "objects": [],
        "links": []
    });
    atomic_write(
        &root.join("board.yaml"),
        &serde_yaml::to_string(&board)
            .map_err(|error| CommandError::new("SERIALIZE_ERROR", format!("无法生成 board.yaml: {error}")))?,
    )?;
    atomic_write(&root.join(".gitignore"), ".prototype/cache/\n*.tmp\n")?;
    atomic_write(
        &root.join(".prototype/index.json"),
        &serde_json::json!({ "version": 1, "generatedAt": now, "pages": [] }).to_string(),
    )?;

    let snapshot = project_snapshot(&root)?;
    activate_project(&state, root)?;
    Ok(Some(snapshot))
}

#[tauri::command]
fn close_project(state: State<'_, DesktopState>) -> CommandResult<()> {
    stop_project_services(&state)?;
    *state
        .project_root
        .lock()
        .map_err(|_| lock_error("当前项目"))? = None;
    Ok(())
}

#[tauri::command]
fn read_project_yaml(state: State<'_, DesktopState>) -> CommandResult<String> {
    let root = active_root(&state)?;
    read_limited(&checked_manifest_path(&root)?, MAX_MANIFEST_BYTES)
}

#[tauri::command]
fn read_page_yaml(page_id: String, state: State<'_, DesktopState>) -> CommandResult<PageDocument> {
    let root = active_root(&state)?;
    let (_, content, _) = read_page_envelope(&root, &page_id)?;
    Ok(PageDocument {
        relative_path: format!("pages/{page_id}.ui.yaml"),
        page_id,
        content,
    })
}

#[tauri::command]
fn write_page_yaml(
    page_id: String,
    content: String,
    state: State<'_, DesktopState>,
) -> CommandResult<PageDocument> {
    if content.len() as u64 > MAX_PAGE_BYTES {
        return Err(CommandError::new(
            "FILE_TOO_LARGE",
            "页面 YAML 超过 16 MiB 限制。",
        ));
    }
    parse_page_document(&page_id, &content)?;

    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    let path = checked_page_write_path(&root, &page_id)?;
    atomic_write(&path, &content)?;
    Ok(PageDocument {
        relative_path: format!("pages/{page_id}.ui.yaml"),
        page_id,
        content,
    })
}

#[tauri::command]
fn read_board_yaml(state: State<'_, DesktopState>) -> CommandResult<String> {
    let root = active_root(&state)?;
    let board_path = ensure_within_root(&root, &root.join("board.yaml"))?;
    if !board_path.is_file() {
        return Err(CommandError::new(
            "INVALID_PROJECT",
            "项目缺少 board.yaml，请在 Studio 中重新打开项目。",
        ));
    }
    read_limited(&board_path, MAX_MANIFEST_BYTES)
}

#[tauri::command]
fn write_board_yaml(content: String, state: State<'_, DesktopState>) -> CommandResult<()> {
    if content.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(CommandError::new("FILE_TOO_LARGE", "board.yaml 超过 1 MiB 限制。"));
    }
    let document: serde_yaml::Value = serde_yaml::from_str(&content)
        .map_err(|error| CommandError::new("INVALID_DSL_FILE", format!("board.yaml 无法解析: {error}")))?;
    if document.get("objects").and_then(|value| value.as_sequence()).is_none() {
        return Err(CommandError::new("INVALID_DSL_FILE", "board.yaml 缺少 objects 数组。"));
    }
    if document.get("revision").and_then(|value| value.as_u64()).is_none() {
        return Err(CommandError::new("INVALID_DSL_FILE", "board.yaml 缺少 revision。"));
    }
    let project_root = active_root(&state)?;
    let board_path = ensure_within_root(&project_root, &project_root.join("board.yaml"))?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("画布持久化"))?;
    atomic_write(&board_path, &content)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardRevisionRecordInput {
    id: String,
    board_id: String,
    revision: u64,
    source: String,
    operator: String,
    base_revision: u64,
    commands: serde_json::Value,
    before: serde_json::Value,
    after: serde_json::Value,
    changed_object_ids: Vec<String>,
    created_at: String,
}

fn append_board_audit(root: &Path, record: &BoardRevisionRecordInput) -> CommandResult<()> {
    let prototype = checked_safe_directory(root, Path::new(".prototype"), true)?;
    let audit_path = prototype.join("audit.jsonl");
    if fs::symlink_metadata(&audit_path)
        .map(|metadata| metadata.file_type().is_symlink() || !metadata.is_file())
        .unwrap_or(false)
    {
        return Err(CommandError::new(
            "INVALID_AUDIT_FILE",
            "audit.jsonl 必须是项目内部的普通文件。",
        ));
    }
    let line = serde_json::to_string(&serde_json::json!({
        "revisionId": record.id,
        "boardId": record.board_id,
        "revision": record.revision,
        "source": record.source,
        "operator": record.operator,
        "changedObjectIds": record.changed_object_ids,
        "createdAt": record.created_at,
    }))
    .map_err(|error| CommandError::new("SERIALIZE_ERROR", format!("无法生成审计记录: {error}")))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .map_err(|error| CommandError::io("无法打开 audit.jsonl", error))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|error| CommandError::io("无法追加审计记录", error))
}

#[tauri::command]
fn persist_board_revision(
    content: String,
    revision_record: serde_json::Value,
    state: State<'_, DesktopState>,
) -> CommandResult<()> {
    if content.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(CommandError::new("FILE_TOO_LARGE", "board.yaml 超过 1 MiB 限制。"));
    }
    let record: BoardRevisionRecordInput = serde_json::from_value(revision_record).map_err(|error| {
        CommandError::new(
            "INVALID_REVISION_RECORD",
            format!("BoardRevisionRecord JSON 缺少必填字段或类型错误: {error}"),
        )
    })?;
    if record.id.trim().is_empty()
        || record.operator.trim().is_empty()
        || record.created_at.trim().is_empty()
        || !record.commands.is_array()
        || !matches!(
            record.source.as_str(),
            "manual" | "ai" | "mcp" | "api" | "import" | "undo" | "redo" | "external"
        )
    {
        return Err(CommandError::new(
            "INVALID_REVISION_RECORD",
            "BoardRevisionRecord 的 id、source、operator、commands 或 createdAt 无效。",
        ));
    }

    let root = active_root(&state)?;
    let board_path = ensure_within_root(&root, &root.join("board.yaml"))?;
    let current_content = read_limited(&board_path, MAX_MANIFEST_BYTES)?;
    let current: serde_yaml::Value = serde_yaml::from_str(&current_content)
        .map_err(|error| CommandError::new("INVALID_DSL_FILE", format!("board.yaml 无法解析: {error}")))?;
    let current_revision = current
        .get("revision")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| CommandError::new("INVALID_DSL_FILE", "board.yaml 缺少 revision。"))?;
    let next: serde_yaml::Value = serde_yaml::from_str(&content)
        .map_err(|error| CommandError::new("INVALID_DSL_FILE", format!("board.yaml 无法解析: {error}")))?;
    let next_revision = next
        .get("revision")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| CommandError::new("INVALID_DSL_FILE", "board.yaml 缺少 revision。"))?;

    if record.base_revision != current_revision {
        return Err(CommandError::new(
            "REVISION_CONFLICT",
            format!("画布当前 revision 为 {current_revision}，但保存基于 {}. 请重新读取画布。", record.base_revision),
        ));
    }
    if record.revision == 0
        || record.revision > MAX_REVISION
        || record.revision != next_revision
        || record.base_revision.checked_add(1) != Some(record.revision)
    {
        return Err(CommandError::new(
            "INVALID_REVISION_RECORD",
            "BoardRevisionRecord.revision 必须是 baseRevision + 1，且不得超过 999999。",
        ));
    }
    if record.before != yaml_as_json(&current_content)? || record.after != yaml_as_json(&content)? {
        return Err(CommandError::new(
            "REVISION_CONTENT_MISMATCH",
            "BoardRevisionRecord.before/after 必须与当前画布和待保存 YAML 完全一致。",
        ));
    }

    let revision_directory = checked_safe_directory(&root, Path::new(".prototype/revisions/board"), true)?;
    let revision_name = format!("{:06}.json", record.revision);
    let revision_path = revision_directory.join(&revision_name);
    if fs::symlink_metadata(&revision_path).is_ok() {
        return Err(CommandError::new(
            "REVISION_EXISTS",
            format!("画布 Revision {} 已存在，不得覆盖。", record.revision),
        ));
    }
    let revision_json = serde_json::to_string_pretty(&serde_json::json!({
        "id": record.id,
        "boardId": record.board_id,
        "revision": record.revision,
        "source": record.source,
        "operator": record.operator,
        "baseRevision": record.base_revision,
        "commands": record.commands,
        "before": record.before,
        "after": record.after,
        "changedObjectIds": record.changed_object_ids,
        "createdAt": record.created_at,
    }))
    .map_err(|error| CommandError::new("SERIALIZE_ERROR", format!("无法序列化 BoardRevisionRecord: {error}")))?;

    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("画布持久化"))?;
    atomic_write(&board_path, &content)?;
    if let Err(error) = atomic_write(&revision_path, &revision_json) {
        let _ = atomic_write(&board_path, &current_content);
        return Err(error);
    }
    if let Err(error) = append_board_audit(&root, &record) {
        let _ = atomic_write(&board_path, &current_content);
        let _ = fs::remove_file(&revision_path);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
fn export_board_html(content: String, state: State<'_, DesktopState>) -> CommandResult<String> {
    if content.len() as u64 > 8 * 1024 * 1024 {
        return Err(CommandError::new("FILE_TOO_LARGE", "导出的 HTML 超过 8 MiB 限制。"));
    }
    let root = active_root(&state)?;
    let exports = ensure_within_root(&root, &root.join(".prototype/exports"))?;
    fs::create_dir_all(&exports).map_err(|error| CommandError::io("无法创建导出目录", error))?;
    let file_name = format!("board-{}.html", Utc::now().format("%Y%m%d-%H%M%S"));
    let target = exports.join(file_name);
    atomic_write(&target, &content)?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_pages(state: State<'_, DesktopState>) -> CommandResult<Vec<PageSummary>> {
    let root = active_root(&state)?;
    let order = project_snapshot(&root)?.page_ids;
    let mut pages = list_pages_inner(&root)?
        .into_iter()
        .map(|page| (page.id.clone(), page))
        .collect::<HashMap<_, _>>();
    Ok(order
        .into_iter()
        .filter_map(|page_id| pages.remove(&page_id))
        .collect())
}

#[tauri::command]
fn create_page_yaml(
    page_id: String,
    content: String,
    state: State<'_, DesktopState>,
) -> CommandResult<PageDocument> {
    if content.len() as u64 > MAX_PAGE_BYTES {
        return Err(CommandError::new(
            "FILE_TOO_LARGE",
            "页面 YAML 超过 16 MiB 限制。",
        ));
    }
    parse_page_document(&page_id, &content)?;
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    let mut next_order = project_snapshot(&root)?.page_ids;
    let path = checked_page_write_path(&root, &page_id)?;
    if fs::symlink_metadata(&path).is_ok() {
        return Err(CommandError::new(
            "PAGE_EXISTS",
            format!("页面“{page_id}”已存在，不得覆盖。"),
        ));
    }
    atomic_write(&path, &content)?;
    next_order.push(page_id.clone());
    if let Err(error) = update_manifest_page_order(&root, |order| *order = next_order) {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    Ok(PageDocument {
        relative_path: format!("pages/{page_id}.ui.yaml"),
        page_id,
        content,
    })
}

#[tauri::command]
fn reorder_pages(
    page_ids: Vec<String>,
    state: State<'_, DesktopState>,
) -> CommandResult<ProjectSnapshot> {
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    let discovered = list_page_ids(&root)?;
    let requested = page_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let available = discovered
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    if page_ids.len() != requested.len() || requested != available {
        return Err(CommandError::new(
            "INVALID_PAGE_ORDER",
            "pageIds 必须且只能包含当前所有页面，且不能重复。",
        ));
    }
    for page_id in &page_ids {
        validate_page_id(page_id)?;
    }
    update_manifest_page_order(&root, |order| *order = page_ids)?;
    project_snapshot(&root)
}

fn delete_page_inner(root: &Path, page_id: &str, base_revision: u64) -> CommandResult<DeletedPage> {
    let (page_path, _, page) = read_page_envelope(root, page_id)?;
    if page.revision != base_revision {
        return Err(CommandError::new(
            "REVISION_CONFLICT",
            format!(
                "页面当前 revision 为 {}，但删除命令基于 {}。请重新读取页面。",
                page.revision, base_revision
            ),
        ));
    }
    let trash = checked_safe_directory(root, Path::new(".prototype/trash"), true)?;
    let file_name = format!(
        "{}.{}.{}.ui.yaml",
        page_id,
        Utc::now().timestamp_millis(),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let target = trash.join(&file_name);
    fs::rename(&page_path, &target)
        .map_err(|error| CommandError::io("无法将页面移入可恢复回收目录", error))?;
    if let Err(error) = update_manifest_page_order(root, |order| {
        order.retain(|ordered_page_id| ordered_page_id != page_id)
    }) {
        let _ = fs::rename(&target, &page_path);
        return Err(error);
    }
    Ok(DeletedPage {
        page_id: page_id.to_owned(),
        revision: page.revision,
        deleted: true,
        recoverable: true,
        original_path: format!("pages/{page_id}.ui.yaml"),
        trash_path: format!(".prototype/trash/{file_name}"),
    })
}

#[tauri::command]
fn delete_page(
    page_id: String,
    base_revision: u64,
    state: State<'_, DesktopState>,
) -> CommandResult<DeletedPage> {
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    delete_page_inner(&root, &page_id, base_revision)
}

#[tauri::command]
fn trash_page(page_id: String, state: State<'_, DesktopState>) -> CommandResult<ProjectSnapshot> {
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    let (_, _, page) = read_page_envelope(&root, &page_id)?;
    delete_page_inner(&root, &page_id, page.revision)?;
    project_snapshot(&root)
}

#[tauri::command]
fn rename_page(
    page_id: String,
    title: String,
    state: State<'_, DesktopState>,
) -> CommandResult<PageDocument> {
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    let (_, current_content, current) = read_page_envelope(&root, &page_id)?;
    let title = title.trim();
    if current.page.title == title {
        return Ok(PageDocument {
            page_id: page_id.clone(),
            relative_path: format!("pages/{page_id}.ui.yaml"),
            content: current_content,
        });
    }
    if current.revision >= MAX_REVISION {
        return Err(CommandError::new(
            "REVISION_LIMIT",
            "页面 revision 已达到 999999，无法继续追加六位 Revision。",
        ));
    }
    let with_title = rewrite_page_identity(&current_content, &page_id, None, Some(title))?;
    let next_content = rewrite_page_revision(&with_title, current.revision, current.revision + 1)?;
    let record = serde_json::json!({
        "id": Uuid::new_v4().to_string(),
        "pageId": page_id,
        "revision": current.revision + 1,
        "source": "manual",
        "operator": "Prototype Studio Desktop",
        "baseRevision": current.revision,
        "commands": [],
        "before": yaml_as_json(&current_content)?,
        "after": yaml_as_json(&next_content)?,
        "changedComponentIds": [],
        "createdAt": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
    });
    Ok(persist_revision_inner(&root, &page_id, &next_content, &record)?.page)
}

#[tauri::command]
fn rename_page_id(
    page_id: String,
    new_page_id: String,
    base_revision: u64,
    state: State<'_, DesktopState>,
) -> CommandResult<PageDocument> {
    validate_page_id(&new_page_id)?;
    if page_id == new_page_id {
        return read_page_yaml(page_id, state);
    }
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    let mut next_order = project_snapshot(&root)?.page_ids;
    let (source, current_content, current) = read_page_envelope(&root, &page_id)?;
    if current.revision != base_revision {
        return Err(CommandError::new(
            "REVISION_CONFLICT",
            format!(
                "页面当前 revision 为 {}，但重命名基于 {}。请重新读取页面。",
                current.revision, base_revision
            ),
        ));
    }
    let target = checked_page_write_path(&root, &new_page_id)?;
    if fs::symlink_metadata(&target).is_ok() {
        return Err(CommandError::new(
            "PAGE_EXISTS",
            format!("页面“{new_page_id}”已存在。"),
        ));
    }
    let next_content = rewrite_page_identity(&current_content, &page_id, Some(&new_page_id), None)?;
    atomic_write(&source, &next_content)?;
    if let Err(error) = fs::rename(&source, &target) {
        let _ = atomic_write(&source, &current_content);
        return Err(CommandError::io("无法重命名页面文件", error));
    }
    for ordered_page_id in &mut next_order {
        if ordered_page_id == &page_id {
            *ordered_page_id = new_page_id.clone();
        }
    }
    if let Err(error) = update_manifest_page_order(&root, |order| *order = next_order) {
        let _ = fs::rename(&target, &source);
        let _ = atomic_write(&source, &current_content);
        return Err(error);
    }
    Ok(PageDocument {
        page_id: new_page_id.clone(),
        relative_path: format!("pages/{new_page_id}.ui.yaml"),
        content: next_content,
    })
}

#[tauri::command]
fn persist_page_revision(
    page_id: String,
    content: String,
    revision_record: serde_json::Value,
    state: State<'_, DesktopState>,
) -> CommandResult<PersistedRevision> {
    let root = active_root(&state)?;
    let _guard = state
        .persistence
        .lock()
        .map_err(|_| lock_error("页面持久化"))?;
    persist_revision_inner(&root, &page_id, &content, &revision_record)
}

fn sidecar_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    let resource_dir = app.path().resource_dir().map_err(|error| {
        CommandError::new(
            "SIDECAR_UNAVAILABLE",
            format!("无法定位应用资源目录: {error}"),
        )
    })?;
    #[cfg(target_os = "windows")]
    let binary_name = "prototype-mcp.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "prototype-mcp";
    Ok(resource_dir.join("bin").join(binary_name))
}

fn validate_sidecar_path(app: &tauri::AppHandle, executable: &Path) -> CommandResult<PathBuf> {
    let resource_dir = app.path().resource_dir().map_err(|error| {
        CommandError::new(
            "SIDECAR_UNAVAILABLE",
            format!("无法定位应用资源目录: {error}"),
        )
    })?;
    let resource_dir = fs::canonicalize(resource_dir)
        .map_err(|error| CommandError::io("无法验证应用资源目录", error))?;
    let executable = fs::canonicalize(executable)
        .map_err(|error| CommandError::io("无法验证 Local MCP sidecar", error))?;
    if !executable.starts_with(&resource_dir) || !executable.is_file() {
        return Err(CommandError::new(
            "SIDECAR_OUTSIDE_RESOURCES",
            "拒绝启动应用资源目录之外的 Local MCP sidecar。",
        ));
    }
    Ok(executable)
}

#[tauri::command]
fn start_local_mcp(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<McpStatus> {
    let root = active_root(&state)?;
    let executable = sidecar_path(&app)?;
    if !executable.is_file() {
        return Ok(McpStatus {
            state: "unavailable".to_owned(),
            project_root: Some(root.to_string_lossy().into_owned()),
            pid: None,
            detail: Some(format!(
                "Local MCP sidecar 尚未打包：{}",
                executable.to_string_lossy()
            )),
        });
    }
    let executable = validate_sidecar_path(&app, &executable)?;

    let mut runtime = state.mcp.lock().map_err(|_| lock_error("Local MCP"))?;
    let running_pid = if let Some(child) = runtime.child.as_mut() {
        child
            .try_wait()
            .map_err(|error| CommandError::io("无法检查 Local MCP 状态", error))?
            .is_none()
            .then(|| child.id())
    } else {
        None
    };
    if let Some(pid) = running_pid {
        return Ok(McpStatus {
            state: "running".to_owned(),
            project_root: runtime
                .project_root
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            pid: Some(pid),
            detail: Some("Desktop 正在托管该 stdio MCP 会话。".to_owned()),
        });
    }
    if runtime.child.is_some() {
        runtime.child = None;
    }

    let mut child = Command::new(&executable)
        .env("PROTOTYPE_STUDIO_PROJECT_ROOT", &root)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| CommandError::io("无法启动 Local MCP sidecar", error))?;
    std::thread::sleep(Duration::from_millis(40));
    if let Some(status) = child
        .try_wait()
        .map_err(|error| CommandError::io("无法检查 Local MCP 启动状态", error))?
    {
        return Ok(McpStatus {
            state: "stopped".to_owned(),
            project_root: Some(root.to_string_lossy().into_owned()),
            pid: None,
            detail: Some(format!("Local MCP 启动后立即退出: {status}")),
        });
    }
    let pid = child.id();
    runtime.child = Some(child);
    runtime.project_root = Some(root.clone());
    Ok(McpStatus {
        state: "running".to_owned(),
        project_root: Some(root.to_string_lossy().into_owned()),
        pid: Some(pid),
        detail: Some("Desktop 正在托管该 stdio MCP 会话。".to_owned()),
    })
}

#[tauri::command]
fn stop_local_mcp(state: State<'_, DesktopState>) -> CommandResult<McpStatus> {
    let root = state
        .project_root
        .lock()
        .map_err(|_| lock_error("当前项目"))?
        .clone();
    state
        .mcp
        .lock()
        .map_err(|_| lock_error("Local MCP"))?
        .stop()?;
    Ok(McpStatus {
        state: "stopped".to_owned(),
        project_root: root.map(|path| path.to_string_lossy().into_owned()),
        pid: None,
        detail: None,
    })
}

fn toml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn mcp_connection_documents(root: &Path, sidecar: &Path) -> (String, String) {
    let root_string = root.to_string_lossy();
    let sidecar_string = sidecar.to_string_lossy();
    let config_toml = format!(
        "# 粘贴到 ~/.codex/config.toml，或在 Codex 设置 → MCP servers → Add server（类型 STDIO）后重启\n\
         [mcp_servers.prototype_studio]\n\
         command = {}\n\
         env = {{ PROTOTYPE_STUDIO_PROJECT_ROOT = {}, PROTOTYPE_STUDIO_PREVIEW_URL = \"http://127.0.0.1:4173\" }}",
        toml_quote(&sidecar_string),
        toml_quote(&root_string)
    );
    let connect_prompt = format!(
        "已连接 Prototype Studio 本地项目：{}。\n\
         请通过 prototype_studio MCP 服务器协作：先调用 prototype_get_project 与 prototype_list_pages 了解项目现状；需要读取需求时用 prototype_get_requirement。\n\
         修改原型时只提交结构化命令（prototype_apply_commands / prototype_update_component / prototype_move_component / prototype_create_overlay），不要直接改写 DSL 文件。\n\
         每次修改前先调用 prototype_get_dsl 获取最新 revision；若返回 REVISION_CONFLICT，重新读取后再提交。预览地址用 prototype_get_preview_url 获取。",
        root_string
    );
    (config_toml, connect_prompt)
}

#[tauri::command]
fn local_mcp_connection_info(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<McpConnectionInfo> {
    let root = state
        .project_root
        .lock()
        .map_err(|_| lock_error("当前项目"))?
        .clone();
    let sidecar = sidecar_path(&app)?;
    let sidecar_available = sidecar.is_file();
    let mut state_name = "stopped";
    {
        let mut runtime = state.mcp.lock().map_err(|_| lock_error("Local MCP"))?;
        if let Some(child) = runtime.child.as_mut() {
            if child
                .try_wait()
                .map_err(|error| CommandError::io("无法检查 Local MCP 状态", error))?
                .is_none()
            {
                state_name = "running";
            } else {
                runtime.child = None;
                runtime.project_root = None;
            }
        }
    }
    let sidecar_path_string = Some(sidecar.to_string_lossy().into_owned());
    let Some(root) = root else {
        return Ok(McpConnectionInfo {
            state: "stopped".to_owned(),
            project_root: None,
            sidecar_path: sidecar_path_string,
            sidecar_available,
            config_toml: None,
            connect_prompt: None,
            detail: Some("请先打开或创建一个本地项目。".to_owned()),
        });
    };
    let root_string = root.to_string_lossy().into_owned();
    let (config_toml, connect_prompt) = mcp_connection_documents(&root, &sidecar);
    Ok(McpConnectionInfo {
        state: state_name.to_owned(),
        project_root: Some(root_string),
        sidecar_path: sidecar_path_string,
        sidecar_available,
        config_toml: Some(config_toml),
        connect_prompt: Some(connect_prompt),
        detail: if sidecar_available {
            None
        } else {
            Some("Local MCP sidecar 尚未打包，请先执行 pnpm --dir apps/desktop build。".to_owned())
        },
    })
}

#[tauri::command]
fn local_mcp_status(state: State<'_, DesktopState>) -> CommandResult<McpStatus> {
    let mut runtime = state.mcp.lock().map_err(|_| lock_error("Local MCP"))?;
    let project_root = runtime
        .project_root
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let Some(child) = runtime.child.as_mut() else {
        return Ok(McpStatus {
            state: "stopped".to_owned(),
            project_root,
            pid: None,
            detail: None,
        });
    };
    match child
        .try_wait()
        .map_err(|error| CommandError::io("无法检查 Local MCP 状态", error))?
    {
        None => Ok(McpStatus {
            state: "running".to_owned(),
            project_root,
            pid: Some(child.id()),
            detail: Some("Desktop 正在托管该 stdio MCP 会话。".to_owned()),
        }),
        Some(status) => {
            runtime.child = None;
            runtime.project_root = None;
            Ok(McpStatus {
                state: "stopped".to_owned(),
                project_root,
                pid: None,
                detail: Some(format!("Local MCP 已退出: {status}")),
            })
        }
    }
}

fn watched_relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative == Path::new("project.yaml") {
        return Some("project.yaml".to_owned());
    }
    let mut normalized = Vec::new();
    for component in relative.components() {
        let Component::Normal(value) = component else {
            return None;
        };
        normalized.push(value.to_str()?.to_owned());
    }
    if normalized.is_empty() || !WATCHED_DIRECTORIES.contains(&normalized[0].as_str()) {
        return None;
    }
    Some(normalized.join("/"))
}

fn event_operation(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("rename"),
        EventKind::Modify(_) => Some("change"),
        EventKind::Remove(_) => Some("delete"),
        _ => None,
    }
}

fn legacy_event_kind(kind: &EventKind, path_index: usize) -> &'static str {
    match kind {
        EventKind::Create(_) => "add",
        EventKind::Remove(_) => "unlink",
        EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::From)) => "unlink",
        EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::To)) => "add",
        EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::Both)) if path_index == 0 => {
            "unlink"
        }
        EventKind::Modify(ModifyKind::Name(notify::event::RenameMode::Both)) => "add",
        _ => "change",
    }
}

#[tauri::command]
fn start_project_watcher(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> CommandResult<bool> {
    let root = active_root(&state)?;
    let _manifest = checked_manifest_path(&root)?;
    let watch_directories = WATCHED_DIRECTORIES
        .iter()
        .map(|directory| checked_safe_directory(&root, Path::new(directory), false))
        .collect::<CommandResult<Vec<_>>>()?;
    let event_root = root.clone();
    let event_app = app.clone();
    let mut recently_emitted: HashMap<(String, String), Instant> = HashMap::new();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        let Some(operation) = event_operation(&event.kind) else {
            return;
        };
        let paths = event
            .paths
            .iter()
            .filter_map(|path| watched_relative_path(&event_root, path))
            .collect::<Vec<_>>();
        let now = Instant::now();
        recently_emitted
            .retain(|_, emitted_at| now.duration_since(*emitted_at) < Duration::from_secs(2));
        for (index, relative_path) in paths.iter().enumerate() {
            let debounce_key = (operation.to_owned(), relative_path.clone());
            if recently_emitted
                .get(&debounce_key)
                .is_some_and(|emitted_at| now.duration_since(*emitted_at) < WATCH_DEBOUNCE)
            {
                continue;
            }
            recently_emitted.insert(debounce_key, now);
            let previous_relative_path = (operation == "rename" && index > 0)
                .then(|| paths.first().cloned())
                .flatten();
            let _ = event_app.emit(
                "project-file-changed",
                ProjectFileEvent {
                    kind: legacy_event_kind(&event.kind, index).to_owned(),
                    operation: operation.to_owned(),
                    relative_path: relative_path.clone(),
                    previous_relative_path,
                },
            );
        }
    })
    .map_err(|error| CommandError::new("WATCH_ERROR", format!("无法创建文件监听器: {error}")))?;
    for directory in watch_directories {
        watcher
            .watch(&directory, RecursiveMode::Recursive)
            .map_err(|error| {
                CommandError::new(
                    "WATCH_ERROR",
                    format!("无法监听 {}: {error}", directory.to_string_lossy()),
                )
            })?;
    }
    watcher
        .watch(&root, RecursiveMode::NonRecursive)
        .map_err(|error| {
            CommandError::new("WATCH_ERROR", format!("无法监听 Project Root: {error}"))
        })?;
    *state.watcher.lock().map_err(|_| lock_error("文件监听"))? = Some(watcher);
    Ok(true)
}

#[tauri::command]
fn stop_project_watcher(state: State<'_, DesktopState>) -> CommandResult<bool> {
    let stopped = state
        .watcher
        .lock()
        .map_err(|_| lock_error("文件监听"))?
        .take()
        .is_some();
    Ok(stopped)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            select_project_folder,
            open_project_folder,
            create_project,
            close_project,
            read_project_yaml,
            read_page_yaml,
            write_page_yaml,
            read_board_yaml,
            write_board_yaml,
            persist_board_revision,
            export_board_html,
            list_pages,
            create_page_yaml,
            reorder_pages,
            delete_page,
            trash_page,
            rename_page,
            rename_page_id,
            persist_page_revision,
            start_local_mcp,
            stop_local_mcp,
            local_mcp_status,
            local_mcp_connection_info,
            start_project_watcher,
            stop_project_watcher
        ])
        .run(tauri::generate_context!())
        .expect("运行 Prototype Studio 桌面应用失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestProject {
        root: PathBuf,
    }

    impl TestProject {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("prototype-studio-desktop-test-{}", Uuid::new_v4()));
            for directory in [
                "pages",
                "requirements",
                "data",
                "flows",
                ".prototype/revisions",
            ] {
                fs::create_dir_all(root.join(directory)).expect("create fixture directory");
            }
            atomic_write(
                &root.join("project.yaml"),
                "id: test-project\nname: Test Project\nstatus: active\ndslVersion: '1.0'\nrendererVersion: '0.1.0'\ndesignSystemVersion: '0.1.0'\ncreatedAt: '2026-08-08T00:00:00.000Z'\nupdatedAt: '2026-08-08T00:00:00.000Z'\n",
            )
            .expect("write fixture manifest");
            let root = fs::canonicalize(root).expect("canonicalize fixture root");
            Self { root }
        }

        fn write_page(&self, page_id: &str, revision: u64) -> String {
            let content = sample_page(page_id, revision, "案件列表");
            atomic_write(
                &self.root.join(format!("pages/{page_id}.ui.yaml")),
                &content,
            )
            .expect("write fixture page");
            content
        }
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn sample_page(page_id: &str, revision: u64, title: &str) -> String {
        format!(
            "dslVersion: '1.0'\nrendererVersion: '0.1.0'\ndesignSystemVersion: '0.1.0'\nrevision: {revision}\npage:\n  id: {page_id}\n  title: {title}\n  type: list\n  status: InDesign\nlayout:\n  componentId: root\n  type: Page\n  children: []\noverlays: []\nrules: []\nevents: []\n"
        )
    }

    fn revision_record(
        page_id: &str,
        base_revision: u64,
        before: &str,
        after: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "id": format!("revision-{}", base_revision + 1),
            "pageId": page_id,
            "revision": base_revision + 1,
            "source": "manual",
            "operator": "test",
            "baseRevision": base_revision,
            "commands": [],
            "before": yaml_as_json(before).expect("before yaml"),
            "after": yaml_as_json(after).expect("after yaml"),
            "changedComponentIds": ["search.status"],
            "createdAt": "2026-08-08T00:00:00.000Z"
        })
    }

    #[test]
    fn validates_page_ids_and_rejects_path_syntax() {
        assert!(validate_page_id("case-list_2").is_ok());
        for invalid in ["../case", "case/list", "2case", "", "."] {
            assert_eq!(
                validate_page_id(invalid).expect_err("invalid id").code,
                "INVALID_PAGE_ID"
            );
        }
    }

    #[test]
    fn normalizes_only_safe_watched_project_paths() {
        let root = Path::new("/tmp/prototype-project");
        assert_eq!(
            watched_relative_path(root, &root.join("project.yaml")),
            Some("project.yaml".to_owned())
        );
        for relative in [
            "requirements/v1/order.md",
            "pages/order-list.ui.yaml",
            "data/orders.json",
            "flows/order-create.yaml",
        ] {
            assert_eq!(
                watched_relative_path(root, &root.join(relative)),
                Some(relative.to_owned())
            );
        }
        assert_eq!(
            watched_relative_path(root, &root.join("assets/logo.png")),
            None
        );
        assert_eq!(
            watched_relative_path(root, &root.join("pages/../secret.yaml")),
            None
        );
        assert_eq!(
            watched_relative_path(root, Path::new("/tmp/outside.yaml")),
            None
        );
    }

    #[test]
    fn classifies_create_change_rename_and_delete_events() {
        use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};

        assert_eq!(
            event_operation(&EventKind::Create(CreateKind::File)),
            Some("create")
        );
        assert_eq!(
            event_operation(&EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Content
            ))),
            Some("change")
        );
        assert_eq!(
            event_operation(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))),
            Some("rename")
        );
        assert_eq!(
            event_operation(&EventKind::Remove(RemoveKind::File)),
            Some("delete")
        );
        let rename = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        assert_eq!(legacy_event_kind(&rename, 0), "unlink");
        assert_eq!(legacy_event_kind(&rename, 1), "add");
    }

    #[test]
    fn rewrites_page_identity_without_touching_revision() {
        let original = sample_page("case-list", 7, "案件列表");
        let renamed = rewrite_page_identity(
            &original,
            "case-list",
            Some("case-overview"),
            Some("案件概览"),
        )
        .expect("rewrite identity");
        let parsed: PageEnvelope = serde_yaml::from_str(&renamed).expect("parse rewritten page");
        assert_eq!(parsed.page.id, "case-overview");
        assert_eq!(parsed.page.title, "案件概览");
        assert_eq!(parsed.revision, 7);
    }

    #[test]
    fn persists_page_revision_and_append_only_audit() {
        let project = TestProject::new();
        let before = project.write_page("case-list", 1);
        let after = sample_page("case-list", 2, "案件总览");
        let record = revision_record("case-list", 1, &before, &after);

        let persisted = persist_revision_inner(&project.root, "case-list", &after, &record)
            .expect("persist revision");
        assert_eq!(
            persisted.revision_path,
            ".prototype/revisions/case-list/000002.json"
        );
        assert_eq!(
            fs::read_to_string(project.root.join("pages/case-list.ui.yaml"))
                .expect("read current page"),
            after
        );
        let revision_json = fs::read_to_string(
            project
                .root
                .join(".prototype/revisions/case-list/000002.json"),
        )
        .expect("read persisted revision");
        assert!(revision_json.contains("revision-2"));
        let audit =
            fs::read_to_string(project.root.join(".prototype/audit.jsonl")).expect("read audit");
        assert_eq!(audit.lines().count(), 1);
        assert!(audit.contains("search.status"));
    }

    #[test]
    fn rejects_stale_revision_without_mutating_page() {
        let project = TestProject::new();
        let current = project.write_page("case-list", 2);
        let stale_before = sample_page("case-list", 1, "旧页面");
        let stale_after = sample_page("case-list", 2, "过期修改");
        let stale = revision_record("case-list", 1, &stale_before, &stale_after);

        let error = persist_revision_inner(&project.root, "case-list", &stale_after, &stale)
            .expect_err("stale revision must fail");
        assert_eq!(error.code, "REVISION_CONFLICT");
        assert_eq!(
            fs::read_to_string(project.root.join("pages/case-list.ui.yaml"))
                .expect("read unchanged page"),
            current
        );
        assert!(!project
            .root
            .join(".prototype/revisions/case-list/000002.json")
            .exists());
    }

    #[test]
    fn delete_is_revision_checked_and_recoverable() {
        let project = TestProject::new();
        project.write_page("case-list", 3);
        let conflict =
            delete_page_inner(&project.root, "case-list", 2).expect_err("stale delete must fail");
        assert_eq!(conflict.code, "REVISION_CONFLICT");
        assert!(project.root.join("pages/case-list.ui.yaml").exists());

        let deleted = delete_page_inner(&project.root, "case-list", 3).expect("recoverable delete");
        assert!(deleted.recoverable);
        assert!(!project.root.join("pages/case-list.ui.yaml").exists());
        assert!(project.root.join(deleted.trash_path).is_file());
    }

    #[test]
    fn list_pages_returns_valid_summaries_in_file_order() {
        let project = TestProject::new();
        project.write_page("z-page", 4);
        project.write_page("a-page", 2);
        let pages = list_pages_inner(&project.root).expect("list pages");
        assert_eq!(
            pages
                .iter()
                .map(|page| page.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a-page", "z-page"]
        );
        assert_eq!(pages[0].revision, 2);
        assert_eq!(pages[0].page_type.as_deref(), Some("list"));
    }

    #[test]
    fn project_snapshot_honors_manifest_page_order_and_appends_new_pages() {
        let project = TestProject::new();
        project.write_page("z-page", 1);
        project.write_page("a-page", 1);
        project.write_page("new-page", 1);
        update_manifest_page_order(&project.root, |order| {
            *order = vec!["z-page".to_owned(), "a-page".to_owned()]
        })
        .expect("persist page order");

        let snapshot = project_snapshot(&project.root).expect("ordered snapshot");
        assert_eq!(snapshot.page_ids, ["z-page", "a-page", "new-page"]);
        let manifest =
            fs::read_to_string(project.root.join("project.yaml")).expect("read ordered manifest");
        assert!(manifest.contains("pageOrder:"));
    }

    #[test]
    fn builds_mcp_connection_documents_with_escaped_paths() {
        let root = Path::new("/Users/产品/我的 项目");
        let sidecar = Path::new("/Applications/Prototype Studio.app/Contents/Resources/bin/prototype-mcp");
        let (config, prompt) = mcp_connection_documents(root, sidecar);

        assert!(config.contains("[mcp_servers.prototype_studio]"));
        assert!(config.contains("command = \"/Applications/Prototype Studio.app/Contents/Resources/bin/prototype-mcp\""));
        assert!(config.contains("PROTOTYPE_STUDIO_PROJECT_ROOT = \"/Users/产品/我的 项目\""));
        assert!(config.contains("PROTOTYPE_STUDIO_PREVIEW_URL"));
        assert!(prompt.contains("/Users/产品/我的 项目"));
        assert!(prompt.contains("prototype_get_dsl"));
        assert!(prompt.contains("REVISION_CONFLICT"));
    }
}
