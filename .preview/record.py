# Records badgestatus.net/overlay/ for the preview video (runs on GitHub Actions).
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1920, "height": 1080},
                                  record_video_dir="out", record_video_size={"width": 1920, "height": 1080})
        pg = await ctx.new_page()
        await pg.goto("https://badgestatus.net/overlay/?rotate=8", wait_until="networkidle")
        await pg.wait_for_timeout(30000)  # ~4 page rotations + ticker
        await pg.screenshot(path="out/overlay.png")
        await ctx.close()
        await b.close()

asyncio.run(main())
