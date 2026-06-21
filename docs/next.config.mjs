import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  basePath: "/resourcekit",

  serverExternalPackages: ["typescript", "twoslash"],
};

export default withMDX(config);
