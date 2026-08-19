@echo off
echo ============================================================
echo   HEIST v6 SETUP
echo ============================================================
echo.

:: Step 1: Set your package ID and treasury cap from the publish output
set SUI_PACKAGE_ID=0x732ce6fd07519ba4c2698168c46482e95199891f4f810d896ad0dfc3d9e294d8
set SUI_TREASURY_CAP=0x3d9c62edce4fb65a2f571ee0554834203a6c451e39522e303ff28ef076b41e75
set SUI_TREASURY=0x01d4a72efddaa35d8196b2d07f32b619a1e237e74200d5331f565a925bb8ace1

echo Package ID:    %SUI_PACKAGE_ID%
echo Treasury Cap:  %SUI_TREASURY_CAP%
echo Treasury:      %SUI_TREASURY%
echo.
echo Running setup-v6.mjs...
echo.

node setup-v6.mjs

echo.
echo ============================================================
echo   DONE! Copy the env var values from above into Vercel.
echo ============================================================
pause
