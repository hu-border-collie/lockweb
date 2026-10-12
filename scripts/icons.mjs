import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("public/icons", { recursive: true });
mkdirSync("public/splash", { recursive: true });
const icon = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="112" fill="#5268d9"/><rect x="138" y="224" width="236" height="166" rx="44" fill="none" stroke="#ffffff" stroke-width="22"/><path d="M184 224v-60a72 72 0 0 1 144 0v60" fill="none" stroke="#ffffff" stroke-width="22"/><circle cx="256" cy="294" r="17" fill="#ffffff"/><path d="M256 303v31" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/></svg>`;
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
  ["apple-touch-icon", 180],
])
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}.png`);
const devices = [
  [320, 568, 2],
  [375, 667, 2],
  [414, 736, 3],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [414, 896, 2],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
  [768, 1024, 2],
  [820, 1180, 2],
  [834, 1194, 2],
  [1024, 1366, 2],
];
let tags = "";
for (const [w, h, r] of devices) {
  for (const landscape of [false, true]) {
    const pw = (landscape ? h : w) * r,
      ph = (landscape ? w : h) * r;
    const svg = `<svg width="${pw}" height="${ph}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f6f7f9"/><rect x="${pw / 2 - 45 * r}" y="${ph / 2 - 85 * r}" width="${90 * r}" height="${90 * r}" rx="${25 * r}" fill="#5268d9"/><text x="${pw / 2}" y="${ph / 2 + 55 * r}" text-anchor="middle" fill="#202b3e" font-family="sans-serif" font-size="${14 * r}">PRIVATE JOURNAL</text></svg>`;
    const filename = `splash-${pw}x${ph}.png`;
    await sharp(Buffer.from(svg))
      .png()
      .toFile("public/splash/" + filename);
    tags += `<link rel="apple-touch-startup-image" href="./splash/${filename}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: ${landscape ? "landscape" : "portrait"})"/>\n`;
  }
}
const inputHtml = readFileSync("index.html", "utf8");
const splashBlock = `<!-- SPLASH_START -->\n${tags}<!-- SPLASH_END -->`;
const html = inputHtml.includes("<!-- SPLASH_START -->")
  ? inputHtml.replace(
      /<!-- SPLASH_START -->[\s\S]*?<!-- SPLASH_END -->/,
      splashBlock,
    )
  : inputHtml.replace("</head>", splashBlock + "</head>");
writeFileSync("index.html", html);
