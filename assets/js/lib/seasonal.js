// December: the pixel aliens wear a Santa hat (class on <html>, the CSS swaps the images). Test: ?winter=1 / ?winter=0
const p = new URLSearchParams(location.search).get("winter");
const winter = p === "1" ? true : p === "0" ? false : new Date().getMonth() === 11;
if (winter) {
  document.documentElement.classList.add("is-winter");
  for (const im of document.querySelectorAll("img[data-alien]")) im.src = `/assets/img/aliens/${im.dataset.alien}-winter.png`;
}
