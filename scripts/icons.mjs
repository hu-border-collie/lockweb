import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("public/icons", { recursive: true });
mkdirSync("public/splash", { recursive: true });
// 纸本手记图标：暖纸底 + 朱砂印章 + 宋体「私」。
const sealFont = `"Songti SC","STSong","SimSun","Microsoft YaHei",serif`;
const icon = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
<rect width="512" height="512" fill="#f4efe6"/>
<rect x="86" y="86" width="340" height="340" rx="58" fill="#a83a28"/>
<rect x="106" y="106" width="300" height="300" rx="42" fill="none" stroke="#fdf6ec" stroke-width="5" opacity="0.35"/>
<text x="256" y="262" text-anchor="middle" dominant-baseline="central" fill="#fdf6ec" font-family='${sealFont}' font-size="212" font-weight="600">私</text>
</svg>`;
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
    const seal = 92 * r;
    const svg = `<svg width="${pw}" height="${ph}" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" fill="#f4efe6"/>
<rect x="${pw / 2 - seal / 2}" y="${ph / 2 - seal / 2 - 34 * r}" width="${seal}" height="${seal}" rx="${18 * r}" fill="#a83a28"/>
<rect x="${pw / 2 - seal / 2 + 6 * r}" y="${ph / 2 - seal / 2 - 34 * r + 6 * r}" width="${seal - 12 * r}" height="${seal - 12 * r}" rx="${14 * r}" fill="none" stroke="#fdf6ec" stroke-width="${1.4 * r}" opacity="0.35"/>
<text x="${pw / 2}" y="${ph / 2 - 34 * r + 4 * r}" text-anchor="middle" dominant-baseline="central" fill="#fdf6ec" font-family='${sealFont}' font-size="${52 * r}" font-weight="600">私</text>
<text x="${pw / 2}" y="${ph / 2 + seal / 2 - 34 * r + 58 * r}" text-anchor="middle" fill="#241f1a" font-family='${sealFont}' font-size="${30 * r}" letter-spacing="${9 * r}">私记</text>
<text x="${pw / 2}" y="${ph / 2 + seal / 2 - 34 * r + 96 * r}" text-anchor="middle" fill="#7b7161" font-family='"PingFang SC","Microsoft YaHei",sans-serif' font-size="${13 * r}" letter-spacing="${5 * r}">只写给自己</text>
</svg>`;
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
