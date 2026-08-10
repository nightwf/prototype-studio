import { useEffect, useRef, useState, type FormEvent } from "react";
import { FolderOpen, Plus, Sparkles, Upload } from "lucide-react";
import { getApiToken, webAuth, webProjects, type WebProject, type WebUser } from "./webBridge";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: WebUser) => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      if (tab === "login") {
        const user = await webAuth.login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        onAuthenticated(user);
      } else {
        await webAuth.register(String(form.get("inviteCode") ?? ""), String(form.get("name") ?? ""), String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        const user = await webAuth.login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
        onAuthenticated(user);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="web-screen">
      <section className="web-card">
        <header><div><span>PROTOTYPE</span><h1>Prototype Studio</h1><p>网页端 · 多画布原型工作台</p></div></header>
        <div className="web-tabs">
          <button className={tab === "login" ? "is-active" : ""} onClick={() => setTab("login")}>登录</button>
          <button className={tab === "register" ? "is-active" : ""} onClick={() => setTab("register")}>注册</button>
        </div>
        <form onSubmit={submit} className="web-form">
          {tab === "register" ? <label><span>邀请码</span><input name="inviteCode" required placeholder="输入邀请码" /></label> : null}
          {tab === "register" ? <label><span>名称</span><input name="name" required placeholder="你的名字" /></label> : null}
          <label><span>邮箱</span><input name="email" type="email" required placeholder="you@example.com" /></label>
          <label><span>密码</span><input name="password" type="password" required minLength={6} placeholder="至少 6 位" /></label>
          {error ? <div className="web-error">{error}</div> : null}
          <button className="web-primary" disabled={busy}><Sparkles size={14} />{busy ? "处理中…" : tab === "login" ? "登录" : "注册并登录"}</button>
        </form>
      </section>
    </div>
  );
}

export function ProjectsScreen({ user, onOpenProject, onLogout }: {
  user: WebUser;
  onOpenProject: (projectId: string) => void;
  onLogout: () => void;
}) {
  const [projects, setProjects] = useState<WebProject[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const apiToken = getApiToken();

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(apiToken);
    } catch {
      const area = document.createElement("textarea");
      area.value = apiToken;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function refresh() {
    setError(undefined);
    try {
      const result = await webProjects.list();
      setProjects([...result.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载项目失败");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createProject() {
    if (!name.trim()) return;
    try {
      const result = await webProjects.create(name.trim());
      onOpenProject(result.project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    }
  }

  async function importProject(file: File) {
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      const result = await webProjects.import(file.name.replace(/\.zip$/i, ""), base64);
      onOpenProject(result.project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败");
    }
  }

  return (
    <div className="web-screen">
      <section className="web-card web-projects">
        <header>
          <div><span>PROJECTS</span><h1>我的项目</h1><p>{user.name} · {user.email}</p></div>
          <div className="web-header-actions">
            <button className="web-ghost" onClick={() => void refresh()}>刷新</button>
            <button className="web-ghost" onClick={() => void onLogout()}>退出登录</button>
          </div>
        </header>
        <div className="web-create-row">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="新项目名称" onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }} />
          <button className="web-primary" disabled={!name.trim()} onClick={() => void createProject()}><Plus size={14} />新建项目</button>
          <input ref={fileRef} type="file" accept=".zip" style={{ display: "none" }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); }} />
          <button className="web-ghost" onClick={() => fileRef.current?.click()}><Upload size={14} />导入整包</button>
        </div>
        <div className="web-token-row">
          <span>API Token（Codex 连接用）</span>
          <code>{apiToken.slice(0, 16)}…</code>
          <button className="web-ghost" onClick={() => void copyToken()}>{copied ? "已复制" : "复制"}</button>
        </div>
        {error ? <div className="web-error">{error}</div> : null}
        <div className="web-project-list">
          {projects.length ? projects.map((project) => (
            <button key={project.id} className="web-project-row" onClick={() => onOpenProject(project.id)}>
              <FolderOpen size={16} /><span><strong>{project.name}</strong><small>{project.description || project.id}</small></span>
            </button>
          )) : <div className="web-empty">还没有项目，输入名称新建一个。</div>}
        </div>
      </section>
    </div>
  );
}
