from pathlib import Path
from playwright.sync_api import sync_playwright, expect


OUTPUT = Path(__file__).resolve().parents[1] / ".prototype" / "screenshots" / "studio-e2e.png"
BOARD_OUTPUT = Path(__file__).resolve().parents[1] / ".prototype" / "screenshots" / "multi-board-e2e.png"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")

    expect(page.get_by_text("Preview 已连接")).to_be_visible(timeout=10000)
    preview = page.frame_locator('iframe[title="案件管理 Preview"]')
    expect(preview.get_by_role("heading", name="案件管理", exact=True)).to_be_visible()
    expect(preview.locator('[data-component-id="search.status"]')).to_be_visible()

    # Settings panel: shows the Codex connection guide even in browser mode.
    page.get_by_title("设置").click()
    expect(page.get_by_text("设置 · 连接 Codex", exact=True)).to_be_visible()
    expect(page.get_by_text("浏览器体验模式", exact=False)).to_be_visible()
    page.get_by_role("button", name="关闭设置").click()

    # Canvas view: page frame renders on the board, a note can be added and selected.
    page.get_by_role("button", name="画布", exact=True).click()
    page.locator(".board-list-main").first.click()
    expect(page.locator('[data-board-object="obj-case-list"]')).to_be_visible(timeout=10000)
    page.get_by_role("button", name="说明", exact=True).click()
    note = page.locator('[data-board-object^="note-"]')
    expect(note).to_be_visible(timeout=10000)
    note.click()
    expect(page.get_by_text("说明内容", exact=True)).to_be_visible()

    # Flowchart object: add via toolbar, edit a node label in the inspector.
    page.get_by_role("button", name="流程", exact=True).click()
    flow = page.locator('[data-board-object^="flow-"]')
    expect(flow).to_be_visible(timeout=10000)
    flow.click()
    expect(page.get_by_text("流程图", exact=True)).to_be_visible()
    page.locator(".board-editor-row input").first.fill("创建案件")
    page.get_by_role("button", name="保存流程图", exact=True).click()
    expect(page.get_by_text("画布 Revision", exact=False).first).to_be_visible()

    # Marker: add via the canvas picker (anchored to a component), then drag the pin to adjust its offset.
    page.get_by_role("button", name="标注", exact=True).click()
    page.locator(".board-tool-panel select").nth(1).select_option("search.status")
    page.get_by_role("button", name="添加", exact=True).click()
    pin = page.locator('[data-board-marker]')
    expect(pin).to_be_visible(timeout=10000)
    box = pin.bounding_box()
    assert box is not None
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] / 2 + 28, steps=5)
    page.mouse.up()
    moved = pin.bounding_box()
    assert moved is not None and moved["x"] > box["x"] + 15 and moved["y"] > box["y"] + 10

    # Standalone HTML export of the canvas.
    with page.expect_download() as download_info:
        page.get_by_role("button", name="导出 HTML", exact=True).click()
        page.get_by_role("button", name="当前画布", exact=True).click()
    download = download_info.value
    assert download.suggested_filename.startswith("prototype-")

    page.get_by_role("button", name="页面", exact=True).click()
    page.get_by_role("button", name="打开页面 案件管理").click()

    # Page management: create a legal detail page, switch both ways, rename it,
    # then delete it through the confirmed (recoverable in Desktop) flow.
    page.get_by_title("新建页面").click()
    page.get_by_label("页面名称").fill("客户详情")
    page.get_by_role("button", name="detail", exact=True).click()
    page.get_by_role("button", name="创建页面", exact=True).click()
    expect(page.get_by_role("button", name="打开页面 客户详情")).to_be_visible()
    preview = page.frame_locator('iframe[title="客户详情 Preview"]')
    expect(preview.get_by_role("heading", name="客户详情", exact=True).first).to_be_visible(timeout=10000)

    page.get_by_role("button", name="打开页面 案件管理").click()
    preview = page.frame_locator('iframe[title="案件管理 Preview"]')
    expect(preview.get_by_role("heading", name="案件管理", exact=True)).to_be_visible(timeout=10000)
    page.get_by_role("button", name="打开页面 客户详情").click()

    page.get_by_role("button", name="管理页面 客户详情").click()
    page.get_by_role("button", name="上移", exact=True).click()
    expect(page.locator(".page-row").first).to_contain_text("客户详情")

    page.get_by_role("button", name="管理页面 客户详情").click()
    page.get_by_role("button", name="重命名", exact=True).click()
    page.locator(".app-modal input").fill("客户档案")
    page.get_by_role("button", name="保存", exact=True).click()
    expect(page.get_by_role("button", name="打开页面 客户档案")).to_be_visible()

    page.get_by_role("button", name="管理页面 客户档案").click()
    page.get_by_role("button", name="删除…", exact=True).click()
    page.get_by_role("button", name="确认删除", exact=True).click()
    expect(page.get_by_role("button", name="打开页面 客户档案")).to_have_count(0)
    preview = page.frame_locator('iframe[title="案件管理 Preview"]')
    expect(preview.get_by_role("heading", name="案件管理", exact=True)).to_be_visible(timeout=10000)

    preview.locator('[data-component-id="search.status"]').click()
    expect(page.locator(".selected-path b")).to_have_text("search.status")
    expect(page.get_by_text("案件状态", exact=True).last).to_be_visible()

    page.get_by_role("switch", name="必填").click()
    expect(page.locator(".revision-badge")).to_have_text("2")
    expect(preview.locator('[data-component-id="search.status"] label em')).to_have_text("*")

    page.get_by_title("撤销").click()
    expect(page.locator(".revision-badge")).to_have_text("3")
    expect(preview.locator('[data-component-id="search.status"] label em')).to_have_count(0)

    preview.locator('th[data-component-id="table.amount"]').click()
    expect(page.locator(".selected-path b")).to_have_text("table.amount")
    expect(page.get_by_text("TABLE-COLUMN", exact=True)).to_be_visible()

    page.get_by_role("button", name="版本").click()
    expect(page.get_by_text("版本与变更")).to_be_visible()
    expect(page.get_by_text("撤销操作")).to_be_visible()

    page.screenshot(path=str(OUTPUT), full_page=True)

    page.get_by_role("button", name="画布", exact=True).click()
    page.get_by_title("新建画布").click()
    page.get_by_label("画布名称").fill("回款对账")
    page.locator(".board-page-picker label").filter(has_text="案件管理").locator("input").check()
    page.get_by_role("button", name="创建画布", exact=True).click()
    expect(page.get_by_text("回款对账", exact=True).first).to_be_visible()
    expect(page.get_by_text("1 页面 · 1 对象", exact=False)).to_be_visible()
    page.screenshot(path=str(BOARD_OUTPUT), full_page=True)

    # Removing the final page should leave a usable empty workspace rather than
    # rendering a stale DSL or a broken iframe.
    page.get_by_role("button", name="页面", exact=True).click()
    while page.locator(".page-row").count():
        page.locator(".page-row").first.locator(".page-more").click()
        page.get_by_role("button", name="删除…", exact=True).click()
        page.get_by_role("button", name="确认删除", exact=True).click()
    expect(page.get_by_text("选择或新建一个页面", exact=True)).to_be_visible()
    expect(page.locator('iframe[title="案件管理 Preview"]')).to_have_count(0)
    expect(page.locator(".revision-badge")).to_have_text("0")

    if console_errors:
        raise AssertionError("Browser console errors:\n" + "\n".join(console_errors))
    print(f"E2E_OK screenshots={OUTPUT},{BOARD_OUTPUT}")
    browser.close()
