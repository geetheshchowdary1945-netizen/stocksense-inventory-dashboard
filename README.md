# StockSense - Smart Inventory Management for Small Businesses

StockSense is a responsive, single-page inventory management web application built with vanilla HTML, CSS, and modern JavaScript, backed by Google Firebase (Authentication, Cloud Firestore, Hosting, and Cloud Functions).

---

## 📈 The Reorder Formula Explained

Small businesses often struggle with two extremes:
1. **Stockouts**: Running out of fast-selling items, losing sales and frustrating customers.
2. **Overstock**: Tying up precious working capital in slow-moving items that take up warehouse shelf space.

StockSense solves this using standard quantitative supply-chain inventory formulas:

### 1. Average Daily Sales (ADS)
$$\text{ADS} = \frac{\text{Total Units Sold in Last 30 Days}}{30}$$
Calculates the velocity at which an item leaves inventory each day.

### 2. Reorder Point (ROP)
$$\text{Reorder Point} = (\text{ADS} \times \text{Lead Time (Days)}) + \text{Safety Stock}$$
- **Lead Time**: The number of days between placing an order with the supplier and receiving the physical stock.
- **Safety Stock**: A buffer for supplier delays or sudden demand surges (typically 20% of lead time demand: $\text{ADS} \times \text{Lead Time} \times 0.20$).
- **Rule**: When Current Stock $\le$ Reorder Point, an automated reorder alert is triggered!

### 3. Suggested Order Quantity (Economic Replenishment)
$$\text{Order Qty} = \lceil (\text{ADS} \times (\text{Lead Time} + 14 \text{ Days of Cover})) - \text{Current Stock} \rceil$$
- **14 Days of Cover**: Ensures the business holds roughly two weeks of inventory cushion between regular replenishment cycles.
- If Current Stock is higher than this target, suggested quantity is $0$.

### 4. Overstock / Slow-Mover Risk
- If Current Stock $> (\text{ADS} \times 60 \text{ Days})$ or if the item has $>20$ units with zero sales in 30 days, it is tagged as **Overstock Risk** so the business can hold back further purchases, discount it, or bundle it.

---

## 🚀 Step-by-Step Firebase Setup & Deployment Guide

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**, name it (e.g. `stocksense-prod`), and follow the prompts.
3. Click on the Web icon (`</>`) to register a web app.
4. Copy the `firebaseConfig` snippet.

### Step 2: Enable Firebase Authentication
1. In the Firebase Console sidebar, select **Build > Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab, enable **Email/Password**.

### Step 3: Enable Cloud Firestore
1. In the sidebar, select **Build > Firestore Database**.
2. Click **Create database**.
3. Select your preferred Cloud region and start in **Production mode** (our `firestore.rules` will secure it).

### Step 4: Configure Local Project Files
1. Open `firebase-config.js` and paste your web app credentials:
   ```javascript
   export const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "stocksense-prod.firebaseapp.com",
     projectId: "stocksense-prod",
     storageBucket: "stocksense-prod.appspot.com",
     messagingSenderId: "...",
     appId: "1:...:web:..."
   };
   ```
2. (Optional) For automated SMS/WhatsApp alerts, set Twilio credentials in Firebase Functions or Secret Manager:
   ```bash
   firebase functions:secrets:set TWILIO_ACCOUNT_SID
   firebase functions:secrets:set TWILIO_AUTH_TOKEN
   firebase functions:secrets:set TWILIO_PHONE_NUMBER
   ```
   For email, set SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).

### Step 5: Install Firebase CLI & Login
```bash
npm install -g firebase-tools
firebase login
```

### Step 6: Initialize and Deploy
1. Link your local project:
   ```bash
   firebase use --add stocksense-prod
   ```
2. Build the production bundle:
   ```bash
   npm run build
   ```
3. Deploy everything (Firestore Rules, Cloud Functions, and Hosting):
   ```bash
   firebase deploy
   ```
   Or deploy specific components:
   ```bash
   firebase deploy --only firestore:rules
   firebase deploy --only functions
   firebase deploy --only hosting
   ```

4. Your app is now live at: `https://<your-project-id>.web.app`!
