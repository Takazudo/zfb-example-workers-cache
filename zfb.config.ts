import { defineConfig } from "zfb/config";

export default defineConfig({
  framework: "preact",
  tailwind: { enabled: true },
  adapter: "@takazudo/zfb-adapter-cloudflare",
});
