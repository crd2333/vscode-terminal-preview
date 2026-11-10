# vscode-terminal-preview

让 VS Code 集成终端中的**文件路径链接**遵守 `workbench.editor.enablePreview`，通过扩展名列表选择适用的文件类型。

默认启用常见图片、音视频类型，也可以配置为文本、文档或代码等其他类型。未列出的文件类型、目录和网页链接保持原生行为。

## 效果

- `workbench.editor.enablePreview: true`：Ctrl+点击已配置类型的文件路径（macOS 通常为 Cmd+点击），在原生预览标签中打开；下一个预览文件复用当前编辑器组的预览位置。
- 双击上方标签，将文件保留为正式打开的标签；之后打开其他预览不会替换它。
- `workbench.editor.enablePreview: false`：文件正式打开。
- 已经正式打开的文件保持原状，插件不会主动关闭或取消固定任何标签。
- 不要求文件位于工作区内，也不要求把文件目录加入资源管理器。
- 使用 VS Code 默认关联的编辑器，包括文本编辑器、内置图片预览和已安装的自定义编辑器。

## 安装

需要 VS Code 1.93 或更新版本。

1. 在命令面板执行 **Extensions: Install from VSIX…**（扩展：从 VSIX 安装）。
2. 选择 `vscode-terminal-preview-0.1.0.vsix`。
3. 如提示重载，执行 **Developer: Reload Window**。

Remote-SSH / WSL / Dev Container 窗口中应将扩展安装到对应远程环境。扩展声明为 `workspace` 类型，文件检测在工作区所在机器上进行。

也可在对应 VS Code 窗口的集成终端执行：

```sh
code --install-extension /absolute/path/vscode-terminal-preview-0.1.0.vsix
```

**保持内置文件链接检测开启**，无需修改 `terminal.integrated.enableFileLinks`。如果此前按其他方案将其设成了 `"off"`，请恢复默认值，让代码、目录和报错栈继续由 VS Code 处理。

## 设置

默认使用现有预览设置，无需新增预览开关：

```jsonc
{
  "workbench.editor.enablePreview": true
}
```

`terminalPreview.extensions` 决定哪些文件类型使用预览设置。默认接管的扩展名：

- 图片：`png jpg jpeg gif webp bmp ico svg avif`
- 视频：`mp4 webm mov m4v ogv`
- 音频：`mp3 wav ogg oga flac aac m4a`

扩展名只决定链接是否由本插件处理；文件内容的显示、播放能力由 VS Code 和相应编辑器决定。

可以将列表覆盖为任意所需类型；不区分大小写，也允许 `.png` 这种带点写法。例如，让图片、Markdown 和纯文本文件使用预览：

```jsonc
{
  "terminalPreview.extensions": [
    "png", "jpg", "jpeg", "md", "txt"
  ]
}
```

设为 `[]` 会停止接管所有链接。修改设置即时生效。

## 路径支持

支持绝对路径、`./` / `../` 相对路径、`~/`、中文名称、引号内的空格，以及未加引号时用反斜杠转义的空格。Windows 扩展宿主支持盘符和 UNC 路径。只为能通过文件系统检查的文件生成链接。

相对路径优先使用终端 Shell Integration 报告的**当前目录**。没有该信息时，仅在终端创建选项提供了初始目录时使用该目录；初始目录无法跟踪后续 `cd`。无法确定目录时跳过相对路径，绝对路径仍可使用。建议保持 `terminal.integrated.shellIntegration.enabled` 开启。

稳定版 Terminal Link API 不提供某一条历史输出对应的目录。因此，`cd` 后点击旧输出中的相对路径，会按当前目录解析。浏览跨目录的历史输出时请输出绝对路径，例如：

```sh
printf '"%s"\n' /ssd1/your-images/*.png /ssd1/your-images/*.jpg
```

带空格的路径应带引号或转义；不推测未加引号空格的文件名边界。本插件处理文件路径，`https://`、`file://` 等 URI 链接仍交给原生处理。它也不拦截 `code filename` 命令。

## 实现方式

使用公开稳定 API `window.registerTerminalLinkProvider`，只返回配置中的文件类型，并通过 `workspace.fs.stat` 确认目标是文件。点击时重新读取 `workbench.editor.enablePreview`，调用：

```js
vscode.commands.executeCommand('vscode.open', uri, { preview });
```

预览替换、已打开标签复用、双击标签保留都由 VS Code 管理。插件不监听所有标签、不事后关闭文件，也不修改 VS Code 源文件或用户设置。

VS Code 将扩展链接 Provider 注册在内置检测器之前，xterm 按注册顺序选择优先匹配项，因此可以只覆盖所选文件类型的路径，无需禁用 Local Link Detector。源码依据：

- [VS Code terminalLinkManager.ts：_registerStandardLinkProviders](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkManager.ts)
- [xterm LinkProviderService：按顺序注册](https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/LinkProviderService.ts)
- [xterm Linkifier：按 Provider 顺序选择链接](https://github.com/xtermjs/xterm.js/blob/master/src/browser/Linkifier.ts)

## 开发与验证

运行时没有第三方依赖，直接加载 `src/extension.js`。

```sh
npm ci
npm test
npm run package
```

测试包含路径与终端字符偏移、文件类型过滤及自定义类型、真实临时目录、远程 URI、取消请求、并发请求，以及点击时读取预览设置。编辑器打开命令由测试替身记录。

在 VS Code 中打开本目录，按 F5 启动 Extension Development Host 后，可按以下清单检查真实交互：

1. 开启 `workbench.editor.enablePreview`，在终端进入工作区外的图片目录，运行 `ls`。
2. Ctrl+点击第一张、第二张图片，确认标题为斜体，第二张替换第一张。
3. 双击当前标签，再点击第三张图片，确认保留的标签仍在。
4. 保持默认类型列表，在终端输出并点击代码路径和带行列号的报错栈，确认仍按原生方式正式打开。
5. 关闭 `workbench.editor.enablePreview`，点击另一张图片，确认正式打开。
6. 将 `txt`、`md` 加入 `terminalPreview.extensions`，点击对应文件路径，确认也使用预览设置。
7. 在 Remote-SSH 窗口重复测试，确认打开的是远程文件。
