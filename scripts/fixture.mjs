import sharp from "sharp";
await sharp({
  create: { width: 800, height: 600, channels: 3, background: "#a0b4d0" },
})
  .jpeg()
  .toFile("tests/fixture.jpg");
