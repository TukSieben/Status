# Records preview videos on GitHub Actions (real badge images from badgestatus.net).
import asyncio, pathlib
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1920, "height": 1080},
                                  record_video_dir="out", record_video_size={"width": 1920, "height": 1080})
        pg = await ctx.new_page()
        await pg.goto(pathlib.Path(".preview/gameplay.html").resolve().as_uri(), wait_until="networkidle")
        await pg.wait_for_timeout(15000)
        await pg.screenshot(path="out/overlay.png")
        await ctx.close()
        await b.close()

asyncio.run(main())
