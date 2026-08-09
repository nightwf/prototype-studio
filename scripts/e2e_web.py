import os
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
API_PORT = 8787
WEB_PORT = 4176
SPACES_DIR = Path(tempfile.mkdtemp(prefix="prototype-web-e2e-"))
OUTPUT = ROOT / ".prototype" / "screenshots" / "web-e2e.png"


def wait_for_port(port: int, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError(f"端口 {port} 未就绪")


server = subprocess.Popen(
    ["node", "apps/web-server/dist/main.cjs"],
    cwd=str(ROOT),
    env={**os.environ, "PORT": str(API_PORT), "SPACES_DIR": str(SPACES_DIR), "INVITE_CODES": "WEB-E2E"},
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

studio = subprocess.Popen(
    ["pnpm", "--filter", "@prototype-studio/studio", "exec", "vite", "--host", "0.0.0.0", "--port", str(WEB_PORT), "--strictPort"],
    cwd=str(ROOT),
    env={**os.environ, "VITE_WEB_API": f"http://127.0.0.1:{API_PORT}"},
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

try:
    wait_for_port(API_PORT)
    wait_for_port(WEB_PORT)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        console_errors = []
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.goto(f"http://127.0.0.1:{WEB_PORT}", wait_until="networkidle")

        expect(page.get_by_role("heading", name="Prototype Studio", exact=True)).to_be_visible(timeout=10000)
        page.get_by_role("button", name="注册", exact=True).click()
        page.get_by_label("邀请码").fill("WEB-E2E")
        page.get_by_label("名称").fill("测试用户")
        page.get_by_label("邮箱").fill("e2e@example.com")
        page.get_by_label("密码").fill("secret123")
        page.get_by_role("button", name="注册并登录", exact=True).click()

        expect(page.get_by_role("heading", name="我的项目", exact=True)).to_be_visible(timeout=10000)
        page.get_by_placeholder("新项目名称").fill("网页测试项目")
        page.get_by_role("button", name="新建项目", exact=True).click()

        expect(page.get_by_text("网页测试项目", exact=False).first).to_be_visible(timeout=10000)
        page.locator(".left-tabs").get_by_role("button", name="页面", exact=True).click()
        page.get_by_title("新建页面").click()
        page.get_by_label("页面名称").fill("首页")
        page.get_by_role("button", name="创建页面", exact=True).click()
        expect(page.get_by_role("button", name="打开页面 首页")).to_be_visible(timeout=10000)

        page.locator(".view-switcher").get_by_role("button", name="画布", exact=True).click()
        page.get_by_role("button", name="说明", exact=True).click()
        expect(page.locator('[data-board-object^="note-"]')).to_be_visible(timeout=10000)
        expect(page.get_by_text("画布 Revision 2", exact=False).first).to_be_visible(timeout=10000)

        with page.expect_download() as download_info:
            page.get_by_role("button", name="导出 HTML", exact=True).click()
        download = download_info.value
        assert download.suggested_filename == "prototype-board.html"

        # 刷新后回到项目列表，重新打开项目：标注/说明应从服务端恢复。
        page.reload(wait_until="domcontentloaded")
        expect(page.get_by_role("heading", name="我的项目", exact=True)).to_be_visible(timeout=10000)
        page.locator(".web-project-row").first.click()
        page.locator(".view-switcher").get_by_role("button", name="画布", exact=True).click()
        expect(page.locator('[data-board-object^="note-"]')).to_be_visible(timeout=10000)

        page.screenshot(path=str(OUTPUT), full_page=False)
        if console_errors:
            raise AssertionError("Browser console errors:\n" + "\n".join(console_errors[:10]))
        print(f"E2E_WEB_OK screenshot={OUTPUT}")
        browser.close()
finally:
    studio.terminate()
    server.terminate()
    for process in (studio, server):
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    shutil.rmtree(SPACES_DIR, ignore_errors=True)
