@echo off
rem Start the daily sync service as a detached background process.
rem It keeps running after this window closes; use "daemon stop" to stop it.
rem Update PROJECT if you move the project.
set "PROJECT=D:\project\daily"

cd /d "%PROJECT%"
node cli\daily.mjs daemon start
echo.
echo 后台服务已启动，可以关闭本窗口。
timeout /t 3 >nul
