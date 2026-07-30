#!/usr/bin/env zx
import { $, globby } from "zx";
import path from "node:path";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { findUp } from "find-up";

// 打开详细日志，方便调试
$.verbose = true;

async function main() {
  // 1. 初始化路径与配置
  const packageJsonPath = await findUp("package.json");
  if (!packageJsonPath) throw new Error("Could not find package.json");

  const rootPath = path.dirname(packageJsonPath);

  // 加载环境变量
  dotenv.config({ path: path.join(rootPath, ".env.local") });

  // 从 package.json 读取版本
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));

  // 2. 集中配置项
  const CONFIG = {
    projectName: "Bridge Translator",
    identifier: "com.bridge.translator",
    appCategory: "public.app-category.productivity",
    developmentTeam: process.env.DEVELOPMENT_TEAM, // 如果没有设置，后续逻辑会处理
    distPath: "build",
    sourcePath: "build/safari", // Web Extension 产物位置
    version: pkg.version,
  };

  // 设置环境变量
  process.env.NODE_ENV = "production";

  console.log(`🚀 开始构建: ${CONFIG.projectName} v${CONFIG.version}`);

  // 3. 执行构建命令
  // 确保构建目录存在
  await $`pnpm build:safari-output`;

  // 转换项目 (注意：--force 会覆盖已存在的项目)
  await $`xcrun safari-web-extension-converter --bundle-identifier ${CONFIG.identifier} --force --project-location ${CONFIG.distPath} ${CONFIG.sourcePath}`;

  /**
   * 核心逻辑：修改 Xcode 工程配置 (project.pbxproj)
   */
  async function updateProjectConfig() {
    const projectPbxPath = path.join(
      rootPath,
      CONFIG.distPath,
      CONFIG.projectName,
      `${CONFIG.projectName}.xcodeproj`,
      "project.pbxproj"
    );

    let content = await fs.readFile(projectPbxPath, "utf-8");

    // 预先计算 Project Version (例如: 1.2.3 -> 10203)
    const projectVersionInt = parseProjectVersion(CONFIG.version);

    // 准备要注入的 Info.plist 键值对
    const additionalInfoKeys = [
      `INFOPLIST_KEY_LSApplicationCategoryType = "${CONFIG.appCategory}";`,
      `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;`,
    ].join("\n\t\t"); // 使用 Xcode 风格的缩进

    // --- 开始替换 ---

    // 1. 替换 Marketing Version
    content = content.replace(
      /MARKETING_VERSION = .*?;/g,
      `MARKETING_VERSION = ${CONFIG.version};`
    );

    // 2. 替换 Project Version
    content = content.replace(
      /CURRENT_PROJECT_VERSION = \d+;/g,
      `CURRENT_PROJECT_VERSION = ${projectVersionInt};`
    );

    // 3. 注入 Development Team (如果有)
    if (CONFIG.developmentTeam) {
      // 查找 COPY_PHASE_STRIP，在其后插入 TEAM ID
      // 使用更宽松的正则来匹配可能的空白字符
      content = content.replace(
        /(COPY_PHASE_STRIP = NO;)/g,
        `$1\n\t\t\t\tDEVELOPMENT_TEAM = ${CONFIG.developmentTeam};`
      );
    }

    // 4. 注入 InfoPlist 额外配置
    // 原逻辑是在 DisplayName 后追加。这里合并操作，只替换一次，避免重复查找。
    // 匹配: INFOPLIST_KEY_CFBundleDisplayName = "Name";
    const displayNameRegex = new RegExp(
      `(INFOPLIST_KEY_CFBundleDisplayName = "${CONFIG.projectName}";)`,
      "g"
    );
    content = content.replace(
      displayNameRegex,
      `$1\n\t\t${additionalInfoKeys}`
    );

    await fs.writeFile(projectPbxPath, content);
    console.log("✅ Xcode 项目配置已更新");
  }

  /**
   * 核心逻辑：修改 Info.plist
   */
  async function updateInfoPlist() {
    const projectDir = path.join(rootPath, CONFIG.distPath, CONFIG.projectName);
    const files = await globby("**/*.plist", {
      cwd: projectDir,
      absolute: true,
    });

    // 构造要插入的 XML 片段
    const versionXml = `
    <key>CFBundleVersion</key>
    <string>$(CURRENT_PROJECT_VERSION)</string>`;

    for (const file of files) {
      let content = await fs.readFile(file, "utf-8");

      // 使用正则精准匹配文件末尾的 closing tags，忽略空白符差异
      // 替换 </dict>\n</plist> 为 新内容 + 闭合标签
      if (!content.includes("<key>CFBundleVersion</key>")) {
        content = content.replace(
          /\s*<\/dict>\s*<\/plist>\s*$/,
          `${versionXml}\n</dict>\n</plist>`
        );
        await fs.writeFile(file, content);
      }
    }
    console.log(`✅ 已更新 ${files.length} 个 Info.plist 文件`);
  }

  await updateProjectConfig();
  await updateInfoPlist();

  console.log("🎉 构建完成！");
}

function parseProjectVersion(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  // 处理 NaN 情况，防止版本号格式错误导致 NaN
  return (major || 0) * 10000 + (minor || 0) * 100 + (patch || 0);
}

main().catch((err) => {
  console.error("❌ 构建失败:", err);
  process.exit(1);
});
