declare module "zfb/config" {
  export * from "@takazudo/zfb/config";
}

declare module "*.css" {
  const href: string;
  export default href;
}
