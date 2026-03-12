# 🎯 **Sample Data for Login & Testing**

## 👤 **User Credentials for Login:**

### **Admin Login:**
```
Email: admin@mandi.com
Password: admin123
Company: Mandi Traders Pvt Ltd
```

### **Company ID for URL:**
```
Use the company ID from database after running seed
URL: http://localhost:3000/sales/entry?companyId=<COMPANY_ID>
```

## 📊 **Sample Data Created:**

### **🏢 Company Structure:**
- **Trader**: Super Admin (Mumbai)
- **Company**: Mandi Traders Pvt Ltd (Agricultural Market)
- **Products**: Wheat, Rice, Gram Pulses
- **Parties**: 3 buyer parties
- **Sales Bills**: 3 different scenarios (unpaid, paid, partial)

### **🛒 Sales Bill Examples:**

#### **Bill 1: SAL-001 (Unpaid)**
- **Party**: Shri Krishna Traders
- **Date**: 2024-02-11
- **Items**: 
  - Wheat: 30 Qt @ ₹2500 = ₹75,000 (150 bags)
- **Transport**: Fast Transport (MH12AB1234)
  - Freight: ₹1200 (30 Qt × ₹40)
  - Advance: ₹3000
  - TO Pay: -₹1800 (Transport gets money)
- **Total**: ₹75,000
- **Status**: Unpaid

#### **Bill 2: SAL-002 (Paid)**
- **Party**: Maa Laxmi Grain Merchants
- **Date**: 2024-02-10
- **Items**: 
  - Rice: 15 Qt @ ₹3000 = ₹45,000 (75 bags)
- **Total**: ₹45,000
- **Status**: Paid (Full payment received)

#### **Bill 3: SAL-003 (Partial)**
- **Party**: Rajendra & Sons
- **Date**: 2024-02-09
- **Items**: 
  - Pulses: 20 Qt @ ₹3000 = ₹60,000 (100 bags)
- **Transport**: Regional Transport (GJ05CD6789)
  - Freight: ₹700 (20 Qt × ₹35)
  - Advance: ₹2000
  - TO Pay: -₹1300
- **Total**: ₹60,000
- **Received**: ₹20,000
- **Balance**: ₹40,000
- **Status**: Partial

## 🧪 **Manual Testing Steps:**

### **Step 1: Setup Database**
```bash
# Clear existing data
npx prisma db push --force-reset

# Run seed (if syntax errors occur, use manual SQL inserts)
npx tsx prisma/seed-user-credentials.ts
```

### **Step 2: Start Application**
```bash
npm run dev
```

### **Step 3: Login & Test**
1. **Open**: http://localhost:3000
2. **Login**: admin@mandi.com / admin123
3. **Navigate**: Sales Entry
4. **Test**: Create sales bills with sample data
5. **Verify**: All calculations and transport details

## 🔍 **Testing Checklist:**

### **Basic Info:**
- [ ] Party dropdown loads company parties
- [ ] Invoice number auto-generates (SAL-004, etc.)
- [ ] Date picker works
- [ ] Form validation works

### **Transport Info:**
- [ ] Transport name input works
- [ ] Lorry number input works
- [ ] Freight calculations correct (TO Pay = Freight - Advance)
- [ ] TO Pay field is read-only

### **Items Table:**
- [ ] Product dropdown shows sales items
- [ ] Add item functionality works
- [ ] Calculations correct (Qt = kg/100, Amount = Qt × Rate)
- [ ] Delete item works
- [ ] Totals update automatically

### **Save Functionality:**
- [ ] Sales bill creates successfully
- [ ] Transport bill creates separately
- [ ] Transaction rollback works
- [ ] No 500 errors
- [ ] Success message shows

### **Data Verification:**
- [ ] Check database for created records
- [ ] Verify foreign key relationships
- [ ] Confirm calculations match mandi practices
- [ ] Test duplicate invoice prevention

## 🎯 **Expected Results:**

After successful setup and testing, you should have:

1. **Working Login System** with admin credentials
2. **Complete Sales Entry** with all features functional
3. **Sample Data** for immediate testing
4. **Production-Ready** mandi trading software

## 📋 **Company ID Extraction:**

After running the seed, get the company ID from:
```sql
SELECT id FROM Company WHERE name = 'Mandi Traders Pvt Ltd';
```

Use this ID in the URL parameter for testing.

**Ready for complete mandi trading workflow testing!** 🚀
