import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Layers, Share2 } from "lucide-react";
import "./shareViewer.css";

/** 分享只提供画布视图：页面作为画布里的内容渲染，不单独提供页面浏览入口。 */
interface ShareData {
  project: { id: string; name: string; description?: string; defaultBoardId: string };
  pages: Array<{ id: string; title: string }>;
  boards: Array<{ id: string; name: string; description?: string }>;
}

export function ShareViewer() {
  const token = useMemo(() => window.location.pathname.match(/^\/share\/([^/]+)/)?.[1] ?? "", []);
  const [data, setData] = useState<ShareData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then((response) => response.json())
      .then((body) => {
        if (!body?.ok) throw new Error(body?.message ?? "发布链接不可用。");
        setData(body as ShareData);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "发布链接不可用。"));
  }, [token]);

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
        <div className="share-viewer-tabs" role="status" aria-label="查看模式">
          <span className="share-viewer-mode"><LayoutGrid size={14} />画布</span>
        </div>
        <div className="share-viewer-project">
          <strong>{data.project.name}</strong>
          {data.project.description ? <span>{data.project.description}</span> : null}
        </div>
      </header>
      <div className="share-viewer-canvas">
        <iframe src={`/share/${encodeURIComponent(token)}/boards`} title="画布查看器" />
      </div>
    </div>
  );
}
