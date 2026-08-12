import { useCallback, useEffect, useMemo, useState } from "react";
import type { NavigationItem, PageDSL } from "@prototype-studio/dsl-schema";
import { PrototypeRenderer, type RuntimeEventPayload } from "@prototype-studio/renderer";
import { Box, FileText, LayoutGrid, Layers, Share2 } from "lucide-react";
import "./shareViewer.css";

interface ShareData {
  project: { id: string; name: string; description?: string; defaultBoardId: string };
  pages: Array<{ id: string; title: string }>;
  boards: Array<{ id: string; name: string; description?: string }>;
}

interface PageGroup {
  label: string;
  items: Array<{ id: string; title: string }>;
}

function groupPages(navigation: NavigationItem[] | undefined, pages: Array<{ id: string; title: string }>): PageGroup[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const groups: PageGroup[] = [];
  const covered = new Set<string>();
  for (const item of navigation ?? []) {
    const children = (item.children ?? [])
      .map((child) => ({ path: child.path ?? child.key, title: child.label }))
      .filter((child) => byId.has(child.path));
    if (!children.length) continue;
    groups.push({
      label: item.label,
      items: children.map((child) => ({ id: child.path, title: byId.get(child.path)!.title }))
    });
    for (const child of children) covered.add(child.path);
  }
  const rest = pages.filter((page) => !covered.has(page.id));
  if (rest.length) groups.push({ label: "其他页面", items: rest });
  return groups.length ? groups : [{ label: "页面", items: pages }];
}

export function ShareViewer() {
  const token = useMemo(() => window.location.pathname.match(/^\/share\/([^/]+)/)?.[1] ?? "", []);
  const [tab, setTab] = useState<"pages" | "canvas">("pages");
  const [data, setData] = useState<ShareData>();
  const [dslCache, setDslCache] = useState<Record<string, PageDSL>>({});
  const [selectedPageId, setSelectedPageId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then((response) => response.json())
      .then((body) => {
        if (!body?.ok) throw new Error(body?.message ?? "发布链接不可用。");
        setData(body);
        const first = body.pages?.[0]?.id;
        if (first) setSelectedPageId(first);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "发布链接不可用。"));
  }, [token]);

  const loadDsl = useCallback(async (pageId: string) => {
    if (!token || !pageId) return;
    setDslCache((current) => {
      if (current[pageId]) return current;
      void fetch(`/api/share/${encodeURIComponent(token)}/pages/${encodeURIComponent(pageId)}`)
        .then((response) => response.json())
        .then((body) => {
          if (!body?.ok) throw new Error(body?.message ?? "页面加载失败。");
          setDslCache((latest) => ({ ...latest, [pageId]: body.dsl as PageDSL }));
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "页面加载失败。"));
      return current;
    });
  }, [token]);

  useEffect(() => {
    if (selectedPageId) void loadDsl(selectedPageId);
  }, [selectedPageId, loadDsl]);

  const groups = useMemo(() => {
    if (!data) return [];
    const firstDsl = data.pages[0] ? dslCache[data.pages[0].id] : undefined;
    return groupPages(firstDsl?.layout?.navigation?.items, data.pages);
  }, [data, dslCache]);

  const selectedDsl = selectedPageId ? dslCache[selectedPageId] : undefined;

  const runtime = (payload: RuntimeEventPayload) => {
    if (payload.type === "navigate") {
      const target = payload.path ?? payload.target;
      if (target && data?.pages.some((page) => page.id === target)) setSelectedPageId(target);
    }
  };

  if (error) {
    return (
      <div className="share-viewer share-viewer--state">
        <div className="share-viewer-state-card">
          <Share2 size={22} />
          <strong>无法打开发布项目</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="share-viewer share-viewer--state">
        <div className="share-viewer-state-card">
          <Layers size={22} />
          <strong>正在加载项目…</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="share-viewer">
      <header className="share-viewer-top">
        <div className="share-viewer-tabs" role="tablist" aria-label="查看模式">
          <button type="button" role="tab" aria-selected={tab === "pages"} className={tab === "pages" ? "is-active" : ""} onClick={() => setTab("pages")}>
            <FileText size={14} />页面
          </button>
          <button type="button" role="tab" aria-selected={tab === "canvas"} className={tab === "canvas" ? "is-active" : ""} onClick={() => setTab("canvas")}>
            <LayoutGrid size={14} />画布
          </button>
        </div>
        <div className="share-viewer-project">
          <strong>{data.project.name}</strong>
          {data.project.description ? <span>{data.project.description}</span> : null}
        </div>
      </header>

      {tab === "pages" ? (
        <div className="share-viewer-body">
          <aside className="share-viewer-pages">
            {groups.map((group) => (
              <section key={group.label} className="share-viewer-group">
                <h3>{group.label}</h3>
                {group.items.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    className={page.id === selectedPageId ? "is-active" : ""}
                    onClick={() => setSelectedPageId(page.id)}
                  >
                    <span className="share-viewer-page-icon"><Box size={12} /></span>
                    {page.title}
                  </button>
                ))}
              </section>
            ))}
          </aside>
          <main className="share-viewer-page">
            {selectedDsl ? (
              <PrototypeRenderer dsl={selectedDsl} interactive onRuntimeEvent={runtime} />
            ) : (
              <div className="share-viewer-page-loading">正在加载页面…</div>
            )}
          </main>
        </div>
      ) : (
        <div className="share-viewer-canvas">
          <iframe src={`/share/${encodeURIComponent(token)}/boards`} title="画布查看器" />
        </div>
      )}
    </div>
  );
}
