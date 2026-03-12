#!/bin/bash

echo "🚨 APPLYING CRITICAL SECURITY FIXES"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Run this script from the billing-app root directory"
    exit 1
fi

# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

echo "📝 Creating .env.local file..."
cat > .env.local << EOF
# Database Configuration
DATABASE_URL="file:./dev.db"

# JWT Configuration - CRITICAL SECURITY
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="7d"

# CORS Configuration
ALLOWED_ORIGINS="http://localhost:3000"

# Next.js Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
EOF

echo "✅ .env.local created with secure secrets"

echo "🔧 Fixing JWT secret in lib/auth.ts..."
# Backup original file
cp lib/auth.ts lib/auth.ts.backup

# Apply the fix
sed -i 's/const JWT_SECRET = process.env.JWT_SECRET || .*/const JWT_SECRET = process.env.JWT_SECRET/' lib/auth.ts

# Add the validation check after the JWT_SECRET line
sed -i '/const JWT_SECRET = process.env.JWT_SECRET/a\\nif (!JWT_SECRET) {\n  throw new Error("JWT_SECRET environment variable is required")\n}' lib/auth.ts

echo "✅ JWT secret fixed in lib/auth.ts"

echo "🔧 Fixing import path in app/dashboard/page.tsx..."
# Backup original file
cp app/dashboard/page.tsx app/dashboard/page.tsx.backup

# Fix the import path
sed -i "s|import DashboardLayout from '../components/DashboardLayout'|import DashboardLayout from '@/app/components/DashboardLayout'|" app/dashboard/page.tsx

echo "✅ Import path fixed"

echo "🧪 Running quick tests..."
echo "Testing TypeScript compilation..."
npx tsc --noEmit

if [ $? -eq 0 ]; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed - check errors above"
    exit 1
fi

echo ""
echo "🎉 CRITICAL FIXES APPLIED SUCCESSFULLY!"
echo ""
echo "📋 What was fixed:"
echo "   ✅ Created .env.local with secure JWT secret"
echo "   ✅ Fixed hardcoded JWT secret vulnerability"
echo "   ✅ Fixed import path error"
echo ""
echo "🚀 Next steps:"
echo "   1. Run 'npm run dev' to test the application"
echo "   2. Test login functionality"
echo "   3. See QUICK_FIX_CHECKLIST.md for remaining security fixes"
echo "   4. See BUG_FIX_DOCUMENTATION.md for complete fix instructions"
echo ""
echo "⚠️  IMPORTANT: Do NOT deploy to production until all security fixes are complete!"
echo ""

# Show the generated JWT secret for reference
echo "📄 Generated JWT Secret (save this securely):"
echo "${JWT_SECRET}"
echo ""
