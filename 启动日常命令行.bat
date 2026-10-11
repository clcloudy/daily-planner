@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20.19+ 或 22.12+，然后重新运行本脚本。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

rem 命令行版零依赖，不需要 npm install，也不会启动 Vite。
node "cli\daily.mjs" %*

if errorlevel 1 (
  echo.
  echo 命令行版退出时报告了错误，请查看上方信息。
  pause
)

endlocal
