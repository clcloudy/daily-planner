@echo off
rem Open PowerShell in the project folder and run the daily CLI.
rem Works from anywhere (desktop, start menu, or a shortcut).
rem Update PROJECT if you move the project.
set "PROJECT=D:\project\daily"

cd /d "%PROJECT%"
start "" powershell -NoLogo -NoProfile -NoExit -Command "node cli\daily.mjs"
