# 🎯 **Quick Setup Guide - Sales Entry Testing**

## 🚀 **Step 1: Start Application**
```bash
npm run dev
```

## 🔐 **Step 2: Open Prisma Studio**
```bash
# Already running in background at http://localhost:5555
```

## 👤 **Step 3: Login & Test**
```
1. Open: http://localhost:3000
2. Login: admin@mandi.com / admin123
3. Navigate: Sales Entry
4. Test with sample data
```

## 📊 **Sample Data Created:**

### **Company & Users:**
- ✅ Trader: Super Admin
- ✅ Company: Mandi Traders Pvt Ltd
- ✅ Admin User: admin@mandi.com / admin123

### **Products:**
- ✅ Wheat (Premium) - ₹2500/Qt
- ✅ Rice (Basmati) - ₹3000/Qt
- ✅ Gram Pulses - ₹4000/Qt

### **Parties:**
- ✅ Shri Krishna Traders
- ✅ Maa Laxmi Grain Merchants  
- ✅ Rajendra & Sons

### **Sales Bills:**
- ✅ SAL-001: ₹75,000 (Unpaid, with transport)
- ✅ SAL-002: ₹45,000 (Paid, no transport)
- ✅ SAL-003: ₹60,000 (Partial, with transport)

## 🎯 **Ready for Testing:**

The sales entry system is now **fully functional** with:

1. **Hybrid database schema** (SalesBill + TransportBill)
2. **Working APIs** (sales-invoices + transport-bills)
3. **Sample data** in database
4. **Login system** with admin credentials
5. **Prisma Studio** for database inspection

**Test URL**: http://localhost:3000/sales/entry?companyId=<GET_COMPANY_ID_FROM_PRISMA_STUDIO>

**Login**: admin@mandi.com / admin123

## 🎉 **All Set for Production Testing!**
