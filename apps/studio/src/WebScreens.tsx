import { useState, type FormEvent } from "react";
import { GitBranch, LayoutGrid, Layers3, Sparkles, Table2, UserRound } from "lucide-react";
import { webAuth, type WebUser } from "./webBridge";

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
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="auth-brand-mark"><span className="studio-mark"><i /><b /></span><div><strong>PROTOTYPE</strong><em>STUDIO</em></div></div>
        <h1>把想法直接变成可评审的原型</h1>
        <p className="auth-brand-sub">云托管的需求与原型工作台：页面、画布、标注、流程图、ER 图与文档说明，一套工作流全部覆盖。</p>
        <ul className="auth-brand-points">
          <li><Layers3 size={15} /><span><strong>多画布原型</strong><small>页面、说明、标注、流程、ER 一屏编排</small></span></li>
          <li><Table2 size={15} /><span><strong>Word 式文档说明</strong><small>表格、流程图、ER 直接嵌入说明页</small></span></li>
          <li><GitBranch size={15} /><span><strong>版本管理</strong><small>保存命名版本，随时切换回溯</small></span></li>
          <li><LayoutGrid size={15} /><span><strong>Codex 协作</strong><small>用自然语言生成页面与画布</small></span></li>
        </ul>
        <div className="auth-brand-foot">网页端 · 多画布原型工作台</div>
      </div>
      <div className="auth-panel">
        <section className="auth-card">
          <header>
            <div className="auth-card-title"><UserRound size={16} /><h2>{tab === "login" ? "欢迎回来" : "创建账号"}</h2></div>
            <p>{tab === "login" ? "登录后直接进入最近编辑的项目" : "注册后自动进入你的第一个项目"}</p>
          </header>
          <div className="web-tabs">
            <button className={tab === "login" ? "is-active" : ""} onClick={() => { setTab("login"); setError(undefined); }}>登录</button>
            <button className={tab === "register" ? "is-active" : ""} onClick={() => { setTab("register"); setError(undefined); }}>注册</button>
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
    </div>
  );
}
