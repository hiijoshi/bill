# Billing App - Technical Documentation

## Overview
This is a comprehensive billing and inventory management system built with Next.js, TypeScript, Prisma, and SQLite. The application manages multiple traders/companies with features for sales, purchases, inventory, payments, and reporting.

## Technology Stack

### Frontend
- **Framework**: Next.js 16.1.4 (App Router)
- **Language**: TypeScript
- **UI**: React 19.2.3
- **Styling**: Tailwind CSS v4
- **Components**: Radix UI, Lucide React icons
- **Forms**: React Hook Form with Zod validation
- **State Management**: React hooks and context

### Backend
- **API**: Next.js API Routes
- **Database**: SQLite with Prisma ORM
- **Authentication**: Custom implementation with hardcoded users
- **File Processing**: XLSX for data import/export

### Development Tools
- **Package Manager**: npm
- **Linting**: ESLint
- **Database Migrations**: Prisma
- **Type Checking**: TypeScript

## Project Structure

```
billing-app/
├── app/                          # Next.js app router
│   ├── api/                      # API routes
│   │   ├── auth/                 # Authentication endpoints
│   │   ├── companies/            # Company management
│   │   ├── [various modules]/    # Feature-specific APIs
│   ├── components/               # Shared UI components
│   ├── dashboard/               # Dashboard pages
│   ├── master/                  # Master data pages
│   ├── purchase/                # Purchase management
│   ├── sales/                   # Sales management
│   ├── payment/                 # Payment management
│   ├── stock/                   # Stock management
│   └── super-admin/             # Super admin features
├── components/                  # Reusable components
│   └── ui/                      # Base UI components
├── lib/                         # Utility libraries
├── prisma/                      # Database schema and migrations
├── public/                      # Static assets
└── [config files]              # Various configuration files
```

## Database Schema

### Core Entities

#### Trader
- Multi-tenant container for users and companies
- One-to-many relationship with Users and Companies

#### User
- Authentication credentials
- Linked to specific trader
- Role-based access (admin/user)

#### Company
- Business entity belonging to a trader
- Contains all business data (parties, products, bills, etc.)

#### Key Business Entities
- **Party**: Buyers/customers for sales transactions
- **Farmer**: Suppliers for purchase transactions
- **Supplier**: Special suppliers for purchase bills
- **Product**: Inventory items with units and pricing
- **Unit**: Measurement units (kg, bags, etc.)

#### Transaction Entities
- **PurchaseBill**: Regular purchase from farmers
- **SpecialPurchaseBill**: Purchase from registered suppliers
- **SalesBill**: Sales to parties
- **Payment**: Payment tracking for both purchase and sales
- **Transport**: Transport management for sales

#### Supporting Entities
- **StockLedger**: Inventory tracking
- **SalesItemMaster**: Master configuration for sales items

## API Endpoints

### Authentication
- `POST /api/auth` - Main authentication endpoint
- `POST /api/auth/login` - Redirects to main auth

### Core Modules
- `GET/POST/PUT/DELETE /api/companies` - Company management
- `GET/POST/PUT/DELETE /api/parties` - Party management
- `GET/POST/PUT/DELETE /api/farmers` - Farmer management
- `GET/POST/PUT/DELETE /api/suppliers` - Supplier management
- `GET/POST/PUT/DELETE /api/products` - Product management
- `GET/POST/PUT/DELETE /api/units` - Unit management

### Transactions
- `GET/POST /api/purchase-bills` - Purchase bill management
- `GET/POST /api/special-purchase-bills` - Special purchase bills
- `GET/POST /api/sales-bills` - Sales bill management
- `GET/POST /api/payments` - Payment management
- `GET/POST /api/transports` - Transport management

### Stock & Reporting
- `GET/POST /api/stock-ledger` - Stock ledger
- `POST /api/stock/adjustment` - Stock adjustments
- Various reporting endpoints

### Authentication Flow

#### Current Implementation (Hardcoded)
The system currently uses hardcoded credentials for testing:

**Valid Users:**
- **Username**: `admin` / **Password**: `admin123`
- **Username**: `admin@mandi.com` / **Password**: `admin123`

Both users have:
- Trader ID: `KR`
- Trader Name: `Mandi Trader`
- Company ID: `KR` (Note: This is a string ID, not a database reference)
- Company Name: `Mandi Traders Ltd`
- Role: `admin`

#### Authentication Process
1. Client sends POST request to `/api/auth` with `{ traderId, userId, password }`
2. Server validates against hardcoded users
3. Returns user, trader, and company information on success
4. CORS headers are set for cross-origin requests

## Frontend Architecture

### Page Structure
The application follows a modular page structure:

#### Main Areas
- **Dashboard**: Overview and quick actions
- **Master Data**: Configuration pages for parties, products, etc.
- **Purchase**: Purchase bill entry and management
- **Sales**: Sales bill entry and management
- **Payment**: Payment tracking and entry
- **Stock**: Inventory management
- **Reports**: Various business reports
- **Super Admin**: Multi-tenant management

#### Key Components
- **DashboardLayout**: Main application layout
- **Sidebar**: Navigation component
- **CompanySelector**: Company switching for multi-tenant support

### State Management
- React hooks for local state
- URL parameters for routing and data passing
- Server components for data fetching

## Known Issues & Common Bugs

### Authentication Issues
1. **Hardcoded Credentials**: Currently using hardcoded users instead of database authentication
2. **CORS Configuration**: Wide open CORS (`Access-Control-Allow-Origin: '*'`) - security risk
3. **Missing Session Management**: No proper session handling or token-based auth

### Data Consistency
1. **Trader-Company Relationships**: Some companies may have null traderId
2. **Stock Ledger**: Manual synchronization required for inventory updates

### Performance Considerations
1. **SQLite Limitations**: Not suitable for high-concurrency production use
2. **Missing Indexes**: Database queries may be slow on large datasets

## Development Setup

### Prerequisites
- Node.js (v20+ recommended)
- npm or yarn

### Installation
```bash
npm install
```

### Database Setup
```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed database (optional)
npx tsx prisma/seed.ts
```

### Development Server
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Testing

### API Testing
Several test files are available in the root directory:
- `test-api-endpoint.js` - General API testing
- `test-companies-api.js` - Companies API testing
- `test-login.html` - Login functionality testing

### Database Verification
- `check-db.js` - Database connection and data verification
- `show-tables.js` - Display all database tables
- `verify-all-data.js` - Comprehensive data verification

## Deployment Considerations

### Environment Variables
Required environment variables:
- `DATABASE_URL` - SQLite database path

### Production Checklist
1. Replace hardcoded authentication with proper database-backed auth
2. Implement proper session management
3. Add input validation and sanitization
4. Set up proper error logging
5. Configure production database (PostgreSQL recommended)
6. Implement proper CORS configuration
7. Add rate limiting and security headers

## Debugging Guide

### Common Issues
1. **Database Connection Errors**
   - Check DATABASE_URL environment variable
   - Verify Prisma client generation
   - Run `npx prisma migrate dev`

2. **Authentication Failures**
   - Verify hardcoded credentials in `/api/auth/route.ts`
   - Check CORS headers
   - Review browser console for errors

3. **API Errors**
   - Check server logs for detailed error messages
   - Verify request body format
   - Ensure proper HTTP methods

### Debugging Tools
- Browser Developer Tools
- Server console logs
- Database inspection tools (DB Browser for SQLite)
- Network tab for API requests

## Security Considerations

### Current Vulnerabilities
1. **Hardcoded Authentication**: Major security risk with fixed credentials
2. **No Input Validation**: APIs accept raw data without proper validation
3. **CORS Wide Open**: `Access-Control-Allow-Origin: '*'` allows all origins
4. **No Rate Limiting**: Vulnerable to brute force attacks
5. **Missing Session Management**: No JWT tokens or proper session handling
6. **Plain Text Passwords**: Hardcoded passwords in source code
7. **No Audit Logging**: No tracking of user actions or API calls

### Recommended Improvements
1. Implement proper authentication with JWT tokens
2. Add comprehensive input validation
3. Configure CORS properly
4. Add rate limiting
5. Implement proper session management
6. Add audit logging
7. Use environment variables for sensitive data

## Future Enhancements

### Immediate Priorities
1. Replace hardcoded authentication with database-backed system
2. Implement proper user roles and permissions
3. Add data validation and error handling
4. Improve database performance with proper indexing

### Medium-term Goals
1. Add comprehensive reporting and analytics
2. Implement real-time notifications
3. Add mobile responsiveness improvements
4. Implement data import/export features

### Long-term Goals
1. Multi-currency support
2. Advanced inventory management
3. Integration with accounting systems
4. Advanced user permissions and workflows

## Contact & Support

For technical issues or questions:
1. Check the debugging guide above
2. Review the test files for API usage examples
3. Examine the database schema for data relationships
4. Check browser console and server logs for error details

---

**Last Updated**: February 2025
**Version**: 0.1.0
