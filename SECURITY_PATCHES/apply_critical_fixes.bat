@echo off
echo 🚨 APPLYING CRITICAL SECURITY FIXES
echo ==================================

REM Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: Run this script from the billing-app root directory
    pause
    exit /b 1
)

echo 📝 Creating .env.local file...

REM Generate a secure JWT secret using PowerShell
for /f "delims=" %%i in ('powershell -Command "[System.Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))"') do set JWT_SECRET=%%i

REM Create .env.local file
(
echo # Database Configuration
echo DATABASE_URL="file:./dev.db"
echo.
echo # JWT Configuration - CRITICAL SECURITY
echo JWT_SECRET="%JWT_SECRET%"
echo JWT_EXPIRES_IN="7d"
echo.
echo # CORS Configuration
echo ALLOWED_ORIGINS="http://localhost:3000"
echo.
echo # Next.js Configuration
echo NEXTAUTH_URL="http://localhost:3000"
echo NEXTAUTH_SECRET="%RANDOM%%RANDOM%%RANDOM%%RANDOM%"
) > .env.local

echo ✅ .env.local created with secure secrets

echo 🔧 Fixing JWT secret in lib/auth.ts...

REM Backup original file
copy lib\auth.ts lib\auth.ts.backup >nul

REM Apply the fix using PowerShell
powershell -Command "(Get-Content lib\auth.ts) -replace 'const JWT_SECRET = process\.env\.JWT_SECRET.*', 'const JWT_SECRET = process.env.JWT_SECRET' | Set-Content lib\auth.ts"

REM Add the validation check
powershell -Command "$content = Get-Content lib\auth.ts; $content = $content -replace '(const JWT_SECRET = process\.env\.JWT_SECRET)', '$1`n`nif (!JWT_SECRET) {`n  throw new Error(\"JWT_SECRET environment variable is required\")`n}'; Set-Content lib\auth.ts $content"

echo ✅ JWT secret fixed in lib/auth.ts

echo 🔧 Fixing import path in app\dashboard\page.tsx...

REM Backup original file
copy app\dashboard\page.tsx app\dashboard\page.tsx.backup >nul

REM Fix the import path
powershell -Command "(Get-Content app\dashboard\page.tsx) -replace \"import DashboardLayout from '\.\./components/DashboardLayout'\", 'import DashboardLayout from ''@/app/components/DashboardLayout''' | Set-Content app\dashboard\page.tsx"

echo ✅ Import path fixed

echo 🧪 Running quick tests...
echo Testing TypeScript compilation...
npx tsc --noEmit

if %errorlevel% equ 0 (
    echo ✅ TypeScript compilation successful
) else (
    echo ❌ TypeScript compilation failed - check errors above
    pause
    exit /b 1
)

echo.
echo 🎉 CRITICAL FIXES APPLIED SUCCESSFULLY!
echo.
echo 📋 What was fixed:
echo    ✅ Created .env.local with secure JWT secret
echo    ✅ Fixed hardcoded JWT secret vulnerability
echo    ✅ Fixed import path error
echo.
echo 🚀 Next steps:
echo    1. Run 'npm run dev' to test the application
echo    2. Test login functionality
echo    3. See QUICK_FIX_CHECKLIST.md for remaining security fixes
echo    4. See BUG_FIX_DOCUMENTATION.md for complete fix instructions
echo.
echo ⚠️  IMPORTANT: Do NOT deploy to production until all security fixes are complete!
echo.

REM Show the generated JWT secret for reference
echo 📄 Generated JWT Secret (save this securely):
echo %JWT_SECRET%
echo.

pause
