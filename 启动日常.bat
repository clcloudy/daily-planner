@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。请先安装 Node.js 20.19+ 或 22.12+，然后重新运行本脚本。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo 正在安装项目依赖，首次运行可能需要一些时间...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络或 npm 错误信息后重试。
    pause
    exit /b 1
  )
)

echo 正在启动 Daily Planner，浏览器将自动打开...
call npm run dev -- --host 127.0.0.1 --open

if errorlevel 1 (
  echo 应用启动失败，请检查上方错误信息。
  pause
)

endlocal
