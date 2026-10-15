/**
 * StockSense - Modern Inventory Management Application
 * Vanilla JavaScript (ES Module) + Firebase (Auth, Firestore Transactions)
 * 
 * Includes:
 * - Mathematical reorder formulas (ADS, ROP, Economic Replenishment)
 * - Atomic Firestore transactions for inventory decrements
 * - Real-time sales analytics and Chart.js integration
 * - Realistic sample data seeder
 * - Seamless fallback for local/demo mode when Firebase credentials are in placeholder state
 */

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  runTransaction,
  serverTimestamp,
  query,
  orderBy
} from 'firebase/firestore';

import { getActiveFirebaseConfig, isPlaceholderConfig } from './firebase-config.js';

// ============================================================================
// 1. STATE & STORAGE MANAGEMENT
// ============================================================================

const state = {
  activeTab: 'dashboard',
  user: null, // { uid, email, isDemo }
  isFirebaseActive: false,
  products: [],
  sales: [],
  suppliers: [],
  purchaseOrders: [],
  alerts: [],
  settings: {
    alertEmail: '',
    alertPhone: '',
    alertWhatsapp: '',
    emailEnabled: true,
    smsEnabled: false,
    whatsappEnabled: false,
    inAppEnabled: true,
    safetyStockPercent: 20
  },
  salesChartInstance: null,
  filters: {
    productSearch: '',
    productCategory: 'all',
    productStatus: 'all',
    salesSearch: '',
    salesStartDate: '',
    salesEndDate: ''
  }
};

let db = null;
let auth = null;

// ============================================================================
// 2. FIREBASE INITIALIZATION & FALLBACK
// ============================================================================

function initializeFirebaseService() {
  const config = getActiveFirebaseConfig();
  const isDemo = isPlaceholderConfig(config);

  const connBadge = document.getElementById('firebase-connection-badge');

  if (!isDemo) {
    try {
      const app = initializeApp(config);
      auth = getAuth(app);
      db = getFirestore(app);
      state.isFirebaseActive = true;

      if (connBadge) {
        connBadge.textContent = `Connected (${config.projectId})`;
        connBadge.className = 'badge badge-instock';
      }

      // Listen for Auth changes
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          state.user = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || 'user@firebase.app',
            isDemo: false
          };
          updateUserDisplay();
          hideAuthModal();
          await loadAllDataFromFirestore();
        } else {
          state.user = null;
          showAuthModal();
        }
      });

      showToast('Connected to Firebase project: ' + config.projectId, 'info');
      return;
    } catch (err) {
      console.warn('Firebase initialization failed; falling back to Local Demo mode:', err);
    }
  }

  // Fallback to Local Demo Mode
  state.isFirebaseActive = false;
  if (connBadge) {
    connBadge.textContent = 'Local Demo Mode (No Cloud Account Required)';
    connBadge.className = 'badge badge-neutral';
  }

  // Load from local storage or set default demo user
  const savedUser = localStorage.getItem('stocksense_demo_user');
  state.user = savedUser ? JSON.parse(savedUser) : {
    uid: 'demo-store-owner',
    email: 'store-owner@coffeebean.demo',
    isDemo: true
  };
  updateUserDisplay();
  loadDataFromLocalStorage();

  // If local data is empty, auto-seed sample data on first visit
  if (state.products.length === 0) {
    seedSampleData(false);
  }
}

function updateUserDisplay() {
  const emailDisplay = document.getElementById('user-email-display');
  const avatar = document.getElementById('user-avatar');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('auth-status-text');

  if (state.user) {
    if (emailDisplay) emailDisplay.textContent = state.user.email;
    if (avatar) avatar.textContent = (state.user.email[0] || 'U').toUpperCase();
    if (statusDot) {
      statusDot.className = 'status-dot ' + (state.user.isDemo ? 'demo' : '');
    }
    if (statusText) {
      statusText.textContent = state.user.isDemo ? 'Demo Business' : 'Cloud Synchronized';
    }
  }
}

// ============================================================================
// 3. PERSISTENCE & DATA PIPELINE
// ============================================================================

async function loadAllDataFromFirestore() {
  if (!state.isFirebaseActive || !state.user || state.user.isDemo) return;
  const uid = state.user.uid;

  try {
    // 1. Products
    const prodSnap = await getDocs(collection(db, `users/${uid}/products`));
    state.products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2. Sales
    const salesSnap = await getDocs(query(collection(db, `users/${uid}/sales`), orderBy('date', 'desc')));
    state.sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 3. Suppliers
    const supSnap = await getDocs(collection(db, `users/${uid}/suppliers`));
    state.suppliers = supSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 4. Purchase Orders
    const poSnap = await getDocs(collection(db, `users/${uid}/purchaseOrders`));
    state.purchaseOrders = poSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 5. Alerts
    const alertSnap = await getDocs(collection(db, `users/${uid}/alerts`));
    state.alerts = alertSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 6. Settings
    const setSnap = await getDoc(doc(db, `users/${uid}/settings/notifications`));
    if (setSnap.exists()) {
      state.settings = { ...state.settings, ...setSnap.data() };
    }

    refreshAllViews();
  } catch (err) {
    console.error('Error fetching data from Firestore:', err);
    showToast('Failed to load Firestore data. Check security rules or network.', 'error');
  }
}

function loadDataFromLocalStorage() {
  try {
    const p = localStorage.getItem('stocksense_products');
    const s = localStorage.getItem('stocksense_sales');
    const sup = localStorage.getItem('stocksense_suppliers');
    const po = localStorage.getItem('stocksense_purchase_orders');
    const al = localStorage.getItem('stocksense_alerts');
    const set = localStorage.getItem('stocksense_settings');

    if (p) state.products = JSON.parse(p);
    if (s) state.sales = JSON.parse(s);
    if (sup) state.suppliers = JSON.parse(sup);
    if (po) state.purchaseOrders = JSON.parse(po);
    if (al) state.alerts = JSON.parse(al);
    if (set) state.settings = { ...state.settings, ...JSON.parse(set) };
  } catch (e) {
    console.warn('Error reading local storage', e);
  }
  refreshAllViews();
}

function saveDataToStorage() {
  if (state.isFirebaseActive && !state.user.isDemo) {
    // Firestore writes happen directly on actions
    return;
  }
  try {
    localStorage.setItem('stocksense_products', JSON.stringify(state.products));
    localStorage.setItem('stocksense_sales', JSON.stringify(state.sales));
    localStorage.setItem('stocksense_suppliers', JSON.stringify(state.suppliers));
    localStorage.setItem('stocksense_purchase_orders', JSON.stringify(state.purchaseOrders));
    localStorage.setItem('stocksense_alerts', JSON.stringify(state.alerts));
    localStorage.setItem('stocksense_settings', JSON.stringify(state.settings));
  } catch (e) {
    console.warn('Could not persist to localStorage', e);
  }
}

// ============================================================================
// 4. MATHEMATICAL REORDER ENGINE & INVENTORY FORMULAS
// ============================================================================

/**
 * Calculates demand velocity, safety buffers, and replenishment points.
 * 
 * FORMULA BREAKDOWN:
 * 1. Average Daily Sales (ADS):
 *    ADS = (Total units sold in the last 30 days) / 30
 * 
 * 2. Reorder Point (ROP):
 *    ROP = (ADS × Supplier Lead Time in Days) + Safety Buffer
 *    - Safety Buffer = ADS × Lead Time × (safetyStockPercent / 100) (default 20%)
 *    When Current Stock <= ROP, an alert must be issued!
 * 
 * 3. Suggested Order Quantity:
 *    Suggested Qty = ceil((ADS × (Lead Time + 14 Days Cover)) - Current Stock)
 *    If current stock is already above cover, Suggested Qty = 0.
 * 
 * 4. Overstock / Slow-Mover Risk:
 *    Item has > 60 days of demand coverage in inventory, or 0 sales with > 20 stock.
 */
function computeReorderMetrics(product) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffTime = thirtyDaysAgo.getTime();

  // 1. Calculate Total Units Sold in last 30 days
  const recentSales = state.sales.filter(s => {
    return s.productId === product.id && new Date(s.date).getTime() >= cutoffTime;
  });
  const unitsSold30d = recentSales.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0);

  // 2. Average Daily Sales (ADS) over 30 days
  const avgDailySales = unitsSold30d / 30;

  // 3. Find supplier lead time
  const supplier = state.suppliers.find(sup => sup.id === product.supplierId || sup.name === product.supplierName);
  const leadTimeDays = supplier && Number(supplier.leadTimeDays) > 0 ? Number(supplier.leadTimeDays) : 7;

  // 4. Reorder Point (ROP) with Safety Buffer
  const safetyBufferMultiplier = (state.settings.safetyStockPercent || 20) / 100;
  const leadTimeDemand = avgDailySales * leadTimeDays;
  const safetyStock = leadTimeDemand * safetyBufferMultiplier;
  const reorderPoint = Math.max(1, Math.ceil(leadTimeDemand + safetyStock));

  // 5. Suggested Order Quantity (Lead time + 14 days operational cushion)
  const targetCoverageDays = leadTimeDays + 14;
  const targetInventory = avgDailySales * targetCoverageDays;
  const suggestedOrderQuantity = Math.max(0, Math.ceil(targetInventory - product.quantity));

  // 6. Overstock Risk Detection (Excessive working capital tied up)
  const daysOfInventoryOnHand = avgDailySales > 0 ? (product.quantity / avgDailySales) : 999;
  const isOverstock = (avgDailySales > 0 && daysOfInventoryOnHand > 60) || (avgDailySales === 0 && product.quantity > 20);

  // 7. Dynamic Status Badge determination
  let status = 'In Stock';
  if (product.quantity <= 0) {
    status = 'Out of Stock';
  } else if (product.quantity <= (product.reorderLevel || reorderPoint)) {
    status = 'Low Stock';
  } else if (isOverstock) {
    status = 'Overstock';
  }

  return {
    unitsSold30d,
    avgDailySales,
    leadTimeDays,
    reorderPoint,
    suggestedOrderQuantity,
    daysOfInventoryOnHand,
    isOverstock,
    status,
    supplierName: supplier ? supplier.name : (product.supplierName || 'General Supplier')
  };
}

// ============================================================================
// 5. SALES TRANSACTION (ATOMIC FIRESTORE REDUCTION)
// ============================================================================

/**
 * Records a sale and automatically decrements stock.
 * In Firebase mode, uses an atomic Firestore transaction to prevent race conditions
 * and forbid selling more than available stock!
 */
async function processSaleTransaction(saleData) {
  const { productId, quantity, date, notes } = saleData;
  const product = state.products.find(p => p.id === productId);

  if (!product) {
    throw new Error('Product not found in inventory.');
  }

  if (quantity <= 0) {
    throw new Error('Sale quantity must be at least 1 unit.');
  }

  // Pre-check stock
  if (product.quantity < quantity) {
    throw new Error(`Insufficient inventory! Only ${product.quantity} units available in stock.`);
  }

  const unitPrice = Number(product.unitPrice || 0);
  const totalAmount = unitPrice * quantity;

  // 1. Firebase Atomic Transaction Mode
  if (state.isFirebaseActive && state.user && !state.user.isDemo) {
    const uid = state.user.uid;
    const productRef = doc(db, `users/${uid}/products/${productId}`);
    const salesColRef = collection(db, `users/${uid}/sales`);
    const alertsColRef = collection(db, `users/${uid}/alerts`);

    await runTransaction(db, async (transaction) => {
      const prodDoc = await transaction.get(productRef);
      if (!prodDoc.exists()) {
        throw new Error('Product does not exist!');
      }

      const currentStock = prodDoc.data().quantity;
      if (currentStock < quantity) {
        throw new Error(`Transaction cancelled: Only ${currentStock} units available.`);
      }

      const newStock = currentStock - quantity;
      const reorderLevel = prodDoc.data().reorderLevel || 10;

      // Update product stock in transaction
      transaction.update(productRef, {
        quantity: newStock,
        updatedAt: new Date().toISOString()
      });

      // Insert sale record in transaction
      const newSaleRef = doc(salesColRef);
      transaction.set(newSaleRef, {
        id: newSaleRef.id,
        productId,
        productName: product.name,
        quantity,
        unitPrice,
        totalAmount,
        date: date || new Date().toISOString().split('T')[0],
        notes: notes || '',
        createdAt: new Date().toISOString()
      });

      // If stock drops below or to reorder level, create in-app alert
      if (newStock <= reorderLevel) {
        const alertRef = doc(alertsColRef);
        transaction.set(alertRef, {
          id: alertRef.id,
          type: newStock === 0 ? 'out_of_stock' : 'low_stock',
          productId,
          productName: product.name,
          message: newStock === 0 
            ? `🚨 OUT OF STOCK: "${product.name}" has 0 units remaining!` 
            : `⚠️ LOW STOCK: "${product.name}" reached ${newStock} units (Reorder point: ${reorderLevel}).`,
          severity: newStock === 0 ? 'danger' : 'warning',
          status: 'unread',
          createdAt: new Date().toISOString()
        });
      }
    });

    // Reload state from database
    await loadAllDataFromFirestore();
    return;
  }

  // 2. Local Fallback Mode
  product.quantity -= quantity;

  const newSale = {
    id: 'sale-' + Date.now(),
    productId,
    productName: product.name,
    quantity,
    unitPrice,
    totalAmount,
    date: date || new Date().toISOString().split('T')[0],
    notes: notes || '',
    createdAt: new Date().toISOString()
  };
  state.sales.unshift(newSale);

  // Check alert condition
  if (product.quantity <= product.reorderLevel) {
    const isOut = product.quantity === 0;
    state.alerts.unshift({
      id: 'alert-' + Date.now(),
      type: isOut ? 'out_of_stock' : 'low_stock',
      productId: product.id,
      productName: product.name,
      message: isOut
        ? `🚨 OUT OF STOCK: "${product.name}" is completely sold out!`
        : `⚠️ LOW STOCK: "${product.name}" is down to ${product.quantity} units (Reorder point: ${product.reorderLevel}).`,
      severity: isOut ? 'danger' : 'warning',
      status: 'unread',
      createdAt: new Date().toISOString()
    });
  }

  saveDataToStorage();
  refreshAllViews();
}

// ============================================================================
// 6. PURCHASE ORDER RECEIPT (AUTOMATIC INVENTORY REPLENISHMENT)
// ============================================================================

async function updatePurchaseOrderStatus(orderId, newStatus) {
  const order = state.purchaseOrders.find(o => o.id === orderId);
  if (!order) return;

  const oldStatus = order.status;
  if (oldStatus === newStatus) return;

  const product = state.products.find(p => p.id === order.productId);

  // When marking as "Received", automatically increase product stock
  if (newStatus === 'Received' && oldStatus !== 'Received') {
    if (product) {
      product.quantity += Number(order.quantity);
      showToast(`Stock replenished: +${order.quantity} units of "${product.name}" added to inventory!`, 'success');
    }
  }

  order.status = newStatus;
  order.updatedAt = new Date().toISOString();
  if (newStatus === 'Received') {
    order.receivedAt = new Date().toISOString();
  }

  if (state.isFirebaseActive && state.user && !state.user.isDemo) {
    const uid = state.user.uid;
    try {
      await updateDoc(doc(db, `users/${uid}/purchaseOrders/${orderId}`), {
        status: newStatus,
        updatedAt: order.updatedAt,
        receivedAt: order.receivedAt || null
      });
      if (product) {
        await updateDoc(doc(db, `users/${uid}/products/${product.id}`), {
          quantity: product.quantity,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error('Error updating order status in Firestore', e);
    }
  } else {
    saveDataToStorage();
  }

  refreshAllViews();
}

// ============================================================================
// 7. SAMPLE DATA SEEDER
// ============================================================================

function seedSampleData(notify = true) {
  // Realistic Small Business: Specialty Artisan Cafe & Roastery
  const sampleSuppliers = [
    {
      id: 'sup-1',
      name: 'Highland Coffee Imports',
      email: 'orders@highlandimports.com',
      phone: '+1 (555) 432-8910',
      whatsapp: '15554328910',
      leadTimeDays: 7,
      notes: 'Premium single-origin greens and roasted beans. Net 30.'
    },
    {
      id: 'sup-2',
      name: 'Pacific Barista Supplies',
      email: 'sales@pacificbarista.com',
      phone: '+1 (555) 872-1100',
      whatsapp: '15558721100',
      leadTimeDays: 3,
      notes: 'Dairy, syrups, and disposable compostable cups.'
    },
    {
      id: 'sup-3',
      name: 'Milan Espresso Gear Co.',
      email: 'support@milangear.com',
      phone: '+1 (555) 901-4433',
      whatsapp: '15559014433',
      leadTimeDays: 14,
      notes: 'Italian tampers, steaming pitchers, and brew baskets.'
    }
  ];

  const sampleProducts = [
    {
      id: 'prod-1',
      name: 'Ethiopian Yirgacheffe Beans (1kg)',
      sku: 'BEAN-ETH-01',
      category: 'Coffee Beans',
      quantity: 8, // Low stock! Reorder level is 15
      unitPrice: 28.00,
      costPrice: 14.50,
      reorderLevel: 15,
      supplierId: 'sup-1',
      supplierName: 'Highland Coffee Imports'
    },
    {
      id: 'prod-2',
      name: 'Guatemala Antigua Dark Roast (1kg)',
      sku: 'BEAN-GUA-02',
      category: 'Coffee Beans',
      quantity: 42,
      unitPrice: 24.50,
      costPrice: 12.00,
      reorderLevel: 12,
      supplierId: 'sup-1',
      supplierName: 'Highland Coffee Imports'
    },
    {
      id: 'prod-3',
      name: 'Organic Barista Oat Milk (1L Case)',
      sku: 'DAIRY-OAT-06',
      category: 'Dairy & Alternatives',
      quantity: 4, // Critical Low stock!
      unitPrice: 32.00,
      costPrice: 19.00,
      reorderLevel: 10,
      supplierId: 'sup-2',
      supplierName: 'Pacific Barista Supplies'
    },
    {
      id: 'prod-4',
      name: 'Madagascar Vanilla Syrup (750ml)',
      sku: 'SYRUP-VAN-75',
      category: 'Syrups & Flavors',
      quantity: 0, // Out of Stock!
      unitPrice: 16.50,
      costPrice: 8.20,
      reorderLevel: 6,
      supplierId: 'sup-2',
      supplierName: 'Pacific Barista Supplies'
    },
    {
      id: 'prod-5',
      name: 'Precision 58.5mm Espresso Tamper',
      sku: 'GEAR-TAMP-58',
      category: 'Brewing Equipment',
      quantity: 48, // Overstock! (Slow moving vs stock)
      unitPrice: 65.00,
      costPrice: 32.00,
      reorderLevel: 5,
      supplierId: 'sup-3',
      supplierName: 'Milan Espresso Gear Co.'
    },
    {
      id: 'prod-6',
      name: 'Compostable 12oz Hot Cups (Case 500)',
      sku: 'CUP-12OZ-500',
      category: 'Packaging',
      quantity: 18,
      unitPrice: 48.00,
      costPrice: 27.50,
      reorderLevel: 8,
      supplierId: 'sup-2',
      supplierName: 'Pacific Barista Supplies'
    }
  ];

  // Generate 30 days of sales history
  const sampleSales = [];
  const today = new Date();

  // High velocity sales for Ethiopian Beans & Oat Milk
  for (let i = 28; i >= 0; i--) {
    const saleDate = new Date();
    saleDate.setDate(today.getDate() - i);
    const dateStr = saleDate.toISOString().split('T')[0];

    // Daily coffee sales
    sampleSales.push({
      id: `sale-eth-${i}`,
      productId: 'prod-1',
      productName: 'Ethiopian Yirgacheffe Beans (1kg)',
      quantity: Math.floor(Math.random() * 3) + 1,
      unitPrice: 28.00,
      totalAmount: 28.00 * (Math.floor(Math.random() * 3) + 1),
      date: dateStr,
      notes: 'Morning espresso batches & retail bags'
    });

    // Oat milk sales
    if (i % 2 === 0) {
      sampleSales.push({
        id: `sale-oat-${i}`,
        productId: 'prod-3',
        productName: 'Organic Barista Oat Milk (1L Case)',
        quantity: Math.floor(Math.random() * 2) + 1,
        unitPrice: 32.00,
        totalAmount: 32.00 * (Math.floor(Math.random() * 2) + 1),
        date: dateStr,
        notes: 'Coffee bar milk supply'
      });
    }

    // Guatemala beans occasionally
    if (i % 4 === 0) {
      sampleSales.push({
        id: `sale-gua-${i}`,
        productId: 'prod-2',
        productName: 'Guatemala Antigua Dark Roast (1kg)',
        quantity: 2,
        unitPrice: 24.50,
        totalAmount: 49.00,
        date: dateStr,
        notes: 'Retail drip customer'
      });
    }
  }

  // 1 single tamper sale in 30 days (causes overstock flag!)
  sampleSales.push({
    id: 'sale-tamper-1',
    productId: 'prod-5',
    productName: 'Precision 58.5mm Espresso Tamper',
    quantity: 1,
    unitPrice: 65.00,
    totalAmount: 65.00,
    date: today.toISOString().split('T')[0],
    notes: 'Home barista kit gift'
  });

  const samplePOs = [
    {
      id: 'po-101',
      orderNumber: 'PO-2026-081',
      productId: 'prod-1',
      productName: 'Ethiopian Yirgacheffe Beans (1kg)',
      supplierId: 'sup-1',
      supplierName: 'Highland Coffee Imports',
      quantity: 30,
      unitCost: 14.50,
      totalCost: 435.00,
      expectedDelivery: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      status: 'Shipped',
      createdAt: new Date().toISOString()
    },
    {
      id: 'po-102',
      orderNumber: 'PO-2026-082',
      productId: 'prod-4',
      productName: 'Madagascar Vanilla Syrup (750ml)',
      supplierId: 'sup-2',
      supplierName: 'Pacific Barista Supplies',
      quantity: 24,
      unitCost: 8.20,
      totalCost: 196.80,
      expectedDelivery: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      status: 'Pending',
      createdAt: new Date().toISOString()
    }
  ];

  const sampleAlerts = [
    {
      id: 'alert-init-1',
      type: 'out_of_stock',
      productId: 'prod-4',
      productName: 'Madagascar Vanilla Syrup (750ml)',
      message: '🚨 OUT OF STOCK: "Madagascar Vanilla Syrup (750ml)" has 0 units remaining!',
      severity: 'danger',
      status: 'unread',
      createdAt: new Date().toISOString()
    },
    {
      id: 'alert-init-2',
      type: 'low_stock',
      productId: 'prod-1',
      productName: 'Ethiopian Yirgacheffe Beans (1kg)',
      message: '⚠️ LOW STOCK: "Ethiopian Yirgacheffe Beans (1kg)" has fallen to 8 units (Reorder point: 15).',
      severity: 'warning',
      status: 'unread',
      createdAt: new Date().toISOString()
    }
  ];

  state.suppliers = sampleSuppliers;
  state.products = sampleProducts;
  state.sales = sampleSales;
  state.purchaseOrders = samplePOs;
  state.alerts = sampleAlerts;

  saveDataToStorage();
  refreshAllViews();

  if (notify) {
    showToast('Sample coffee shop inventory, sales, and suppliers loaded successfully!', 'success');
  }
}

// ============================================================================
// 8. UI RENDERING & COMPONENT SYNCHRONIZATION
// ============================================================================

function refreshAllViews() {
  renderDashboard();
  renderProductsTable();
  renderSalesTable();
  renderReorderRecommendations();
  renderPurchaseOrdersTable();
  renderSuppliersTable();
  renderAlertsList();
  updateCategoryDropdowns();
  updateProductDropdowns();
}

/**
 * Renders Dashboard Metrics, Sales Trend Chart (Chart.js), Top Sellers, and In-App Banner
 */
function renderDashboard() {
  const totalProducts = state.products.length;
  const totalUnits = state.products.reduce((acc, p) => acc + Number(p.quantity || 0), 0);
  const totalStockValue = state.products.reduce((acc, p) => acc + (Number(p.quantity || 0) * Number(p.costPrice || 0)), 0);
  const totalRetailValue = state.products.reduce((acc, p) => acc + (Number(p.quantity || 0) * Number(p.unitPrice || 0)), 0);

  // Count items at or below reorder level
  let lowStockCount = 0;
  const criticalItems = [];

  state.products.forEach(p => {
    const metrics = computeReorderMetrics(p);
    if (metrics.status === 'Low Stock' || metrics.status === 'Out of Stock') {
      lowStockCount++;
      criticalItems.push({ product: p, metrics });
    }
  });

  // Pending purchase orders
  const pendingOrders = state.purchaseOrders.filter(po => po.status === 'Pending' || po.status === 'Shipped');

  // Update DOM KPI elements
  const elTotalProd = document.getElementById('stat-total-products');
  const elTotalUnits = document.getElementById('stat-total-units');
  const elTotalValue = document.getElementById('stat-total-value');
  const elRetailVal = document.getElementById('stat-retail-value');
  const elLowStock = document.getElementById('stat-low-stock-count');
  const elPendingOrders = document.getElementById('stat-pending-orders');
  const elPendingOrdersVal = document.getElementById('stat-pending-orders-val');

  if (elTotalProd) elTotalProd.textContent = totalProducts;
  if (elTotalUnits) elTotalUnits.textContent = `${totalUnits.toLocaleString()} units stored`;
  if (elTotalValue) elTotalValue.textContent = `$${totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elRetailVal) elRetailVal.textContent = `Retail value: $${totalRetailValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (elLowStock) elLowStock.textContent = lowStockCount;
  if (elPendingOrders) elPendingOrders.textContent = pendingOrders.length;
  if (elPendingOrdersVal) {
    const pendingCost = pendingOrders.reduce((sum, o) => sum + Number(o.totalCost || 0), 0);
    elPendingOrdersVal.textContent = `$${pendingCost.toFixed(2)} in transit`;
  }

  // Update In-App Alert Banner
  const alertBanner = document.getElementById('dashboard-alert-banner');
  const alertText = document.getElementById('dashboard-alert-text');
  const navAlertBadge = document.getElementById('nav-alert-badge');

  if (lowStockCount > 0) {
    if (alertBanner) alertBanner.style.display = 'flex';
    if (alertText) {
      alertText.textContent = `Attention: ${lowStockCount} item${lowStockCount > 1 ? 's are' : ' is'} at or below reorder threshold and require replenishment.`;
    }
    if (navAlertBadge) {
      navAlertBadge.style.display = 'inline-block';
      navAlertBadge.textContent = lowStockCount;
    }
  } else {
    if (alertBanner) alertBanner.style.display = 'none';
    if (navAlertBadge) navAlertBadge.style.display = 'none';
  }

  // Render Dashboard Critical Stock Table
  const critTbody = document.getElementById('dashboard-critical-stock-body');
  if (critTbody) {
    if (criticalItems.length === 0) {
      critTbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <span class="empty-icon">✅</span>
            <div class="empty-title">All items healthy</div>
            <div class="empty-desc">No products are currently below their safety reorder points.</div>
          </td>
        </tr>`;
    } else {
      critTbody.innerHTML = criticalItems.map(({ product, metrics }) => {
        const badgeClass = metrics.status === 'Out of Stock' ? 'badge-outofstock' : 'badge-lowstock';
        return `
          <tr>
            <td><strong>${escapeHtml(product.name)}</strong></td>
            <td><code>${escapeHtml(product.sku)}</code></td>
            <td><strong style="color: ${metrics.status === 'Out of Stock' ? 'var(--danger)' : 'var(--warning-text)'};">${product.quantity}</strong></td>
            <td>${product.reorderLevel}</td>
            <td>${escapeHtml(metrics.supplierName)}</td>
            <td><span class="badge ${badgeClass}">${metrics.status}</span></td>
            <td>
              <button class="btn btn-outline-primary btn-sm btn-quick-reorder" 
                data-prod-id="${product.id}" 
                data-suggested-qty="${metrics.suggestedOrderQuantity}">
                Reorder (${metrics.suggestedOrderQuantity})
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render Top 5 Selling Products
  renderTopSellingProducts();

  // Render Sales Trend Chart (Chart.js via CDN)
  renderSalesTrendChart();
}

/**
 * Aggregates top 5 products by sales volume & revenue in last 30 days
 */
function renderTopSellingProducts() {
  const container = document.getElementById('top-products-list');
  if (!container) return;

  const salesByProduct = {};
  state.sales.forEach(s => {
    if (!salesByProduct[s.productId]) {
      salesByProduct[s.productId] = {
        name: s.productName,
        units: 0,
        revenue: 0
      };
    }
    salesByProduct[s.productId].units += Number(s.quantity || 0);
    salesByProduct[s.productId].revenue += Number(s.totalAmount || 0);
  });

  const sorted = Object.values(salesByProduct)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 2rem 1rem;">
        <span class="empty-icon">📊</span>
        <div class="empty-title">No sales recorded yet</div>
        <div class="empty-desc">Record sales or click "Load Sample Data" to see velocity rankings.</div>
      </div>`;
    return;
  }

  container.innerHTML = sorted.map((item, idx) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.875rem 1.25rem; border-bottom: 1px solid var(--border-color);">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <span style="font-weight: 800; font-size: 0.85rem; color: var(--slate-400); width: 16px;">#${idx + 1}</span>
        <div>
          <div style="font-weight: 600; font-size: 0.875rem; color: var(--slate-800);">${escapeHtml(item.name)}</div>
          <div style="font-size: 0.75rem; color: var(--slate-500);">${item.units} units sold</div>
        </div>
      </div>
      <div style="font-weight: 700; font-size: 0.9rem; color: var(--success);">$${item.revenue.toFixed(2)}</div>
    </div>
  `).join('');
}

/**
 * Initializes and updates the 30-day sales trend Chart.js canvas
 */
function renderSalesTrendChart() {
  const canvas = document.getElementById('salesTrendChart');
  if (!canvas || typeof window.Chart === 'undefined') return;

  // Build daily sales map for past 30 days
  const labels = [];
  const dataPoints = [];
  const today = new Date();
  let totalPeriodRevenue = 0;

  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    labels.push(monthDay);

    const dayTotal = state.sales
      .filter(s => s.date === dateStr)
      .reduce((sum, s) => sum + Number(s.totalAmount || 0), 0);

    dataPoints.push(dayTotal);
    totalPeriodRevenue += dayTotal;
  }

  const chartRevEl = document.getElementById('chart-total-revenue');
  if (chartRevEl) {
    chartRevEl.textContent = `$${totalPeriodRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (30d total)`;
  }

  if (state.salesChartInstance) {
    state.salesChartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(79, 70, 229, 0.25)');
  gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

  state.salesChartInstance = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Daily Revenue ($)',
        data: dataPoints,
        borderColor: '#4f46e5',
        backgroundColor: gradient,
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#4f46e5'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${Number(ctx.raw).toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (val) => `$${val}`
          },
          grid: {
            color: '#f1f5f9'
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 10,
            font: { size: 10 }
          }
        }
      }
    }
  });
}

/**
 * Renders Products & Stock Catalog Table with filtering and status badges
 */
function renderProductsTable() {
  const tbody = document.getElementById('products-table-body');
  if (!tbody) return;

  const search = state.filters.productSearch.toLowerCase();
  const categoryFilter = state.filters.productCategory;
  const statusFilter = state.filters.productStatus;

  const filtered = state.products.filter(p => {
    const metrics = computeReorderMetrics(p);
    const matchesSearch = !search || 
      p.name.toLowerCase().includes(search) || 
      p.sku.toLowerCase().includes(search) || 
      (p.category && p.category.toLowerCase().includes(search));

    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    const matchesStatus = statusFilter === 'all' || metrics.status === statusFilter;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          <span class="empty-icon">📦</span>
          <div class="empty-title">No products found</div>
          <div class="empty-desc">No inventory items matched your criteria. Try adjusting filters or add a new product.</div>
          <button class="btn btn-primary btn-sm" id="btn-empty-add-prod">+ Add Product</button>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const metrics = computeReorderMetrics(p);
    let badgeClass = 'badge-instock';
    if (metrics.status === 'Out of Stock') badgeClass = 'badge-outofstock';
    else if (metrics.status === 'Low Stock') badgeClass = 'badge-lowstock';
    else if (metrics.status === 'Overstock') badgeClass = 'badge-overstock';

    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td><code>${escapeHtml(p.sku)}</code></td>
        <td><span class="badge badge-neutral">${escapeHtml(p.category || 'General')}</span></td>
        <td>
          <span style="font-weight: 700; color: ${p.quantity === 0 ? 'var(--danger)' : 'var(--slate-800)'};">${p.quantity}</span>
        </td>
        <td>$${Number(p.unitPrice).toFixed(2)}</td>
        <td>$${Number(p.costPrice).toFixed(2)}</td>
        <td>${p.reorderLevel}</td>
        <td><span class="badge ${badgeClass}">${metrics.status}</span></td>
        <td>${escapeHtml(metrics.supplierName)}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-secondary btn-sm btn-adjust-stock" data-id="${p.id}" title="Adjust stock count">Adjust</button>
          <button class="btn btn-secondary btn-sm btn-edit-product" data-id="${p.id}">Edit</button>
          <button class="btn btn-danger btn-sm btn-delete-product" data-id="${p.id}">&times;</button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renders Sales History Table with date range filters
 */
function renderSalesTable() {
  const tbody = document.getElementById('sales-table-body');
  if (!tbody) return;

  const search = state.filters.salesSearch.toLowerCase();
  const startDate = state.filters.salesStartDate;
  const endDate = state.filters.salesEndDate;

  const filtered = state.sales.filter(s => {
    const matchesSearch = !search || s.productName.toLowerCase().includes(search);
    const matchesStart = !startDate || s.date >= startDate;
    const matchesEnd = !endDate || s.date <= endDate;
    return matchesSearch && matchesStart && matchesEnd;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <span class="empty-icon">💳</span>
          <div class="empty-title">No sales transactions</div>
          <div class="empty-desc">Click "Record Sale" to add a new transaction and automatically deduct stock.</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td>${escapeHtml(s.date)}</td>
      <td><strong>${escapeHtml(s.productName)}</strong></td>
      <td><span class="badge badge-neutral">${s.quantity} units</span></td>
      <td>$${Number(s.unitPrice).toFixed(2)}</td>
      <td><strong style="color: var(--success);">$${Number(s.totalAmount).toFixed(2)}</strong></td>
      <td style="color: var(--slate-500); font-size: 0.8rem;">${escapeHtml(s.notes || '-')}</td>
    </tr>
  `).join('');
}

/**
 * Renders the Mathematical Reorder Recommendations Table
 */
function renderReorderRecommendations() {
  const tbody = document.getElementById('reorder-recommendations-table-body');
  if (!tbody) return;

  if (state.products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <span class="empty-icon">📈</span>
          <div class="empty-title">No inventory data</div>
          <div class="empty-desc">Add products or load sample data to see quantitative replenishment suggestions.</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = state.products.map(p => {
    const metrics = computeReorderMetrics(p);

    let riskBadge = '<span class="badge badge-instock">Healthy Buffer</span>';
    if (metrics.status === 'Out of Stock') {
      riskBadge = '<span class="badge badge-outofstock">Depleted (0 stock)</span>';
    } else if (metrics.status === 'Low Stock') {
      riskBadge = '<span class="badge badge-lowstock">Reorder Triggered</span>';
    } else if (metrics.status === 'Overstock') {
      riskBadge = '<span class="badge badge-overstock">Slow Mover Risk</span>';
    }

    return `
      <tr>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          <div style="font-size: 0.75rem; color: var(--slate-500);">${escapeHtml(p.sku)} &bull; ${escapeHtml(metrics.supplierName)}</div>
        </td>
        <td><strong>${p.quantity}</strong></td>
        <td>${metrics.avgDailySales.toFixed(2)} units/day</td>
        <td>${metrics.leadTimeDays} days</td>
        <td><strong>${metrics.reorderPoint}</strong> units</td>
        <td>
          <span style="font-weight: 700; color: ${metrics.suggestedOrderQuantity > 0 ? 'var(--primary)' : 'var(--slate-400)'};">
            ${metrics.suggestedOrderQuantity > 0 ? `+${metrics.suggestedOrderQuantity} units` : 'Adequate (0)'}
          </span>
        </td>
        <td>${riskBadge}</td>
        <td style="text-align: right;">
          <button class="btn btn-primary btn-sm btn-quick-reorder" 
            data-prod-id="${p.id}" 
            data-suggested-qty="${metrics.suggestedOrderQuantity}">
            Create Purchase Order
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renders Supplier Purchase Orders Table
 */
function renderPurchaseOrdersTable() {
  const tbody = document.getElementById('purchase-orders-table-body');
  if (!tbody) return;

  if (state.purchaseOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <span class="empty-icon">📋</span>
          <div class="empty-title">No purchase orders placed</div>
          <div class="empty-desc">Create purchase orders to replenish stock. Marking them "Received" increases on-hand inventory automatically.</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = state.purchaseOrders.map(po => {
    let statusBadge = 'badge-neutral';
    if (po.status === 'Received') statusBadge = 'badge-instock';
    else if (po.status === 'Shipped') statusBadge = 'badge-lowstock';
    else if (po.status === 'Pending') statusBadge = 'badge-neutral';
    else if (po.status === 'Cancelled') statusBadge = 'badge-outofstock';

    return `
      <tr>
        <td><code>${escapeHtml(po.orderNumber)}</code></td>
        <td><strong>${escapeHtml(po.productName)}</strong></td>
        <td>${escapeHtml(po.supplierName)}</td>
        <td>${po.quantity} units</td>
        <td><strong>$${Number(po.totalCost || 0).toFixed(2)}</strong></td>
        <td>${escapeHtml(po.expectedDelivery || 'N/A')}</td>
        <td><span class="badge ${statusBadge}">${escapeHtml(po.status)}</span></td>
        <td style="text-align: right; white-space: nowrap;">
          ${po.status !== 'Received' ? `
            <button class="btn btn-success btn-sm btn-mark-received" data-id="${po.id}">
              Mark Received
            </button>
          ` : `
            <span style="font-size: 0.75rem; color: var(--success); font-weight: 600;">✓ In Stock</span>
          `}
          ${po.status === 'Pending' ? `
            <button class="btn btn-secondary btn-sm btn-mark-shipped" data-id="${po.id}">Mark Shipped</button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renders Suppliers Table
 */
function renderSuppliersTable() {
  const tbody = document.getElementById('suppliers-table-body');
  if (!tbody) return;

  if (state.suppliers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <span class="empty-icon">🤝</span>
          <div class="empty-title">No suppliers added</div>
          <div class="empty-desc">Add suppliers with lead times to empower automated reorder forecasts.</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = state.suppliers.map(sup => `
    <tr>
      <td><strong>${escapeHtml(sup.name)}</strong></td>
      <td>
        <a href="mailto:${escapeHtml(sup.email)}" style="color: var(--primary); text-decoration: none;">
          ${escapeHtml(sup.email)}
        </a>
      </td>
      <td>${escapeHtml(sup.phone || '-')}</td>
      <td>
        ${sup.whatsapp ? `
          <a href="https://wa.me/${escapeHtml(sup.whatsapp.replace(/\D/g, ''))}?text=Hello%20${encodeURIComponent(sup.name)}%2C%20inquiry%20from%20StockSense" 
             target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
            💬 WhatsApp
          </a>
        ` : '-'}
      </td>
      <td><span class="badge badge-neutral">${sup.leadTimeDays} days</span></td>
      <td style="font-size: 0.8rem; color: var(--slate-500);">${escapeHtml(sup.notes || '-')}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary btn-sm btn-edit-supplier" data-id="${sup.id}">Edit</button>
        <button class="btn btn-danger btn-sm btn-delete-supplier" data-id="${sup.id}">&times;</button>
      </td>
    </tr>
  `).join('');
}

/**
 * Renders Alerts History List in Settings Tab
 */
function renderAlertsList() {
  const container = document.getElementById('alerts-history-list');
  if (!container) return;

  if (state.alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 2rem 1rem;">
        <span class="empty-icon">🔔</span>
        <div class="empty-title">No active alerts</div>
        <div class="empty-desc">Alerts will automatically trigger when sales push stock below threshold points.</div>
      </div>`;
    return;
  }

  container.innerHTML = state.alerts.map(a => `
    <div style="padding: 0.875rem 1.25rem; border-bottom: 1px solid var(--border-color); display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;">
      <div>
        <div style="font-size: 0.85rem; font-weight: 600; color: ${a.severity === 'danger' ? 'var(--danger)' : 'var(--warning-text)'};">
          ${escapeHtml(a.message)}
        </div>
        <div style="font-size: 0.75rem; color: var(--slate-400); margin-top: 0.2rem;">
          ${a.createdAt ? new Date(a.createdAt).toLocaleString() : 'Recent'}
        </div>
      </div>
      <button class="btn btn-secondary btn-sm btn-dismiss-alert" data-id="${a.id}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
        Dismiss
      </button>
    </div>
  `).join('');
}

function updateCategoryDropdowns() {
  const select = document.getElementById('products-filter-category');
  const datalist = document.getElementById('category-datalist');
  if (!select) return;

  const categories = Array.from(new Set(state.products.map(p => p.category).filter(Boolean)));

  const currentVal = select.value;
  select.innerHTML = '<option value="all">All Categories</option>' + 
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.value = currentVal;

  if (datalist) {
    datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }
}

function updateProductDropdowns() {
  // 1. Sale Product Select
  const saleSelect = document.getElementById('sale-product-select');
  if (saleSelect) {
    saleSelect.innerHTML = '<option value="">Choose item to sell...</option>' +
      state.products.map(p => `
        <option value="${p.id}" ${p.quantity === 0 ? 'disabled' : ''}>
          ${escapeHtml(p.name)} (${p.quantity} units available - $${Number(p.unitPrice).toFixed(2)})
        </option>
      `).join('');
  }

  // 2. Purchase Order Product Select
  const poSelect = document.getElementById('po-product-select');
  if (poSelect) {
    poSelect.innerHTML = '<option value="">Choose item to reorder...</option>' +
      state.products.map(p => `
        <option value="${p.id}">${escapeHtml(p.name)} (Current stock: ${p.quantity})</option>
      `).join('');
  }

  // 3. Product Supplier Select
  const supSelect = document.getElementById('prod-supplier-select');
  if (supSelect) {
    supSelect.innerHTML = '<option value="">Select a supplier...</option>' +
      state.suppliers.map(s => `
        <option value="${s.id}">${escapeHtml(s.name)} (${s.leadTimeDays}d lead time)</option>
      `).join('');
  }
}

// ============================================================================
// 9. EVENT LISTENERS & MODAL HANDLERS
// ============================================================================

function setupEventListeners() {
  // Navigation Tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Mobile sidebar toggle
  const mobileToggle = document.getElementById('mobile-toggle-btn');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (mobileToggle && sidebar && backdrop) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('active');
    });
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
    });
  }

  // Top Shortcuts
  document.getElementById('btn-load-sample-data')?.addEventListener('click', () => seedSampleData(true));
  document.getElementById('btn-quick-sale')?.addEventListener('click', () => openModal('modal-sale'));
  document.getElementById('btn-quick-add-product')?.addEventListener('click', () => openAddProductModal());
  document.getElementById('btn-add-product-modal')?.addEventListener('click', () => openAddProductModal());
  document.getElementById('btn-record-sale-modal')?.addEventListener('click', () => openModal('modal-sale'));
  document.getElementById('btn-add-supplier-modal')?.addEventListener('click', () => openAddSupplierModal());
  document.getElementById('btn-create-order-modal')?.addEventListener('click', () => openPurchaseOrderModal());
  document.getElementById('btn-goto-reorders')?.addEventListener('click', () => switchTab('reorders'));
  document.getElementById('btn-banner-view-reorders')?.addEventListener('click', () => switchTab('reorders'));
  document.getElementById('btn-banner-dismiss')?.addEventListener('click', () => {
    const banner = document.getElementById('dashboard-alert-banner');
    if (banner) banner.style.display = 'none';
  });

  // Modal Closers
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Filters
  document.getElementById('products-search-input')?.addEventListener('input', (e) => {
    state.filters.productSearch = e.target.value;
    renderProductsTable();
  });
  document.getElementById('products-filter-category')?.addEventListener('change', (e) => {
    state.filters.productCategory = e.target.value;
    renderProductsTable();
  });
  document.getElementById('products-filter-status')?.addEventListener('change', (e) => {
    state.filters.productStatus = e.target.value;
    renderProductsTable();
  });
  document.getElementById('sales-search-input')?.addEventListener('input', (e) => {
    state.filters.salesSearch = e.target.value;
    renderSalesTable();
  });
  document.getElementById('sales-filter-start-date')?.addEventListener('change', (e) => {
    state.filters.salesStartDate = e.target.value;
    renderSalesTable();
  });
  document.getElementById('sales-filter-end-date')?.addEventListener('change', (e) => {
    state.filters.salesEndDate = e.target.value;
    renderSalesTable();
  });
  document.getElementById('btn-sales-clear-filters')?.addEventListener('click', () => {
    const sInput = document.getElementById('sales-search-input');
    const startInput = document.getElementById('sales-filter-start-date');
    const endInput = document.getElementById('sales-filter-end-date');
    if (sInput) sInput.value = '';
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    state.filters.salesSearch = '';
    state.filters.salesStartDate = '';
    state.filters.salesEndDate = '';
    renderSalesTable();
  });

  // Product Form Submission
  document.getElementById('product-form')?.addEventListener('submit', handleProductFormSubmit);

  // Sale Form Interactive Price Preview & Submission
  const saleSelect = document.getElementById('sale-product-select');
  const saleQtyInput = document.getElementById('sale-quantity');
  if (saleSelect && saleQtyInput) {
    const updateSalePreview = () => {
      const prod = state.products.find(p => p.id === saleSelect.value);
      const stockEl = document.getElementById('sale-available-stock');
      const priceEl = document.getElementById('sale-unit-price');
      const totalEl = document.getElementById('sale-total-preview');
      const warningEl = document.getElementById('sale-stock-warning');
      const submitBtn = document.getElementById('btn-submit-sale');

      if (prod) {
        if (stockEl) stockEl.value = `${prod.quantity} units`;
        if (priceEl) priceEl.value = `$${Number(prod.unitPrice).toFixed(2)}`;
        const qty = Number(saleQtyInput.value) || 0;
        const total = qty * Number(prod.unitPrice);
        if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;

        if (qty > prod.quantity) {
          if (warningEl) warningEl.style.display = 'block';
          if (submitBtn) submitBtn.disabled = true;
        } else {
          if (warningEl) warningEl.style.display = 'none';
          if (submitBtn) submitBtn.disabled = false;
        }
      } else {
        if (stockEl) stockEl.value = '0 units';
        if (priceEl) priceEl.value = '$0.00';
        if (totalEl) totalEl.textContent = '$0.00';
      }
    };
    saleSelect.addEventListener('change', updateSalePreview);
    saleQtyInput.addEventListener('input', updateSalePreview);
  }
  document.getElementById('sale-form')?.addEventListener('submit', handleSaleFormSubmit);

  // Supplier Form Submission
  document.getElementById('supplier-form')?.addEventListener('submit', handleSupplierFormSubmit);

  // Purchase Order Form Submission
  document.getElementById('purchase-order-form')?.addEventListener('submit', handlePurchaseOrderSubmit);

  // PO Product selection auto-populates supplier & costs
  const poProdSelect = document.getElementById('po-product-select');
  const poQtyInput = document.getElementById('po-quantity');
  const poCostInput = document.getElementById('po-unit-cost');
  if (poProdSelect) {
    const updatePOPreview = () => {
      const prod = state.products.find(p => p.id === poProdSelect.value);
      const supNameEl = document.getElementById('po-supplier-name');
      const supIdEl = document.getElementById('po-supplier-id');
      const leadTimeEl = document.getElementById('po-lead-time-display');
      const expDateEl = document.getElementById('po-expected-date');
      const totalCostEl = document.getElementById('po-total-cost-preview');

      if (prod) {
        const sup = state.suppliers.find(s => s.id === prod.supplierId || s.name === prod.supplierName);
        const leadDays = sup ? Number(sup.leadTimeDays) : 7;
        if (supNameEl) supNameEl.value = sup ? sup.name : (prod.supplierName || 'General Supplier');
        if (supIdEl) supIdEl.value = sup ? sup.id : (prod.supplierId || 'sup-1');
        if (leadTimeEl) leadTimeEl.value = `${leadDays} days`;
        if (poCostInput && !poCostInput.value) poCostInput.value = Number(prod.costPrice).toFixed(2);

        // Expected date = today + lead time
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + leadDays);
        if (expDateEl && !expDateEl.value) expDateEl.value = expDate.toISOString().split('T')[0];

        const q = Number(poQtyInput.value) || 0;
        const c = Number(poCostInput.value) || 0;
        if (totalCostEl) totalCostEl.textContent = `$${(q * c).toFixed(2)}`;
      }
    };
    poProdSelect.addEventListener('change', updatePOPreview);
    poQtyInput?.addEventListener('input', updatePOPreview);
    poCostInput?.addEventListener('input', updatePOPreview);
  }

  // Stock Adjustment Form
  document.getElementById('adjust-stock-form')?.addEventListener('submit', handleStockAdjustmentSubmit);

  // Settings Form
  document.getElementById('settings-form')?.addEventListener('submit', handleSettingsFormSubmit);

  // Clear dismissed alerts
  document.getElementById('btn-clear-all-alerts')?.addEventListener('click', () => {
    state.alerts = state.alerts.filter(a => a.status === 'unread');
    saveDataToStorage();
    renderAlertsList();
    showToast('Dismissed alerts cleared from view.', 'info');
  });

  // Table Delegated Actions
  document.addEventListener('click', handleDelegatedTableClicks);

  // Firebase Custom Config Form
  document.getElementById('btn-save-custom-firebase')?.addEventListener('click', handleSaveCustomFirebaseConfig);
  document.getElementById('btn-reset-to-demo')?.addEventListener('click', () => {
    localStorage.removeItem('stocksense_firebase_config');
    showToast('Reset to local demo session.', 'info');
    setTimeout(() => window.location.reload(), 400);
  });

  // Auth Modal Buttons
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    if (state.isFirebaseActive && auth) {
      signOut(auth).then(() => showToast('Signed out of Firebase.', 'info'));
    } else {
      showAuthModal();
    }
  });

  document.getElementById('auth-tab-login')?.addEventListener('click', () => toggleAuthTabs('login'));
  document.getElementById('auth-tab-signup')?.addEventListener('click', () => toggleAuthTabs('signup'));
  document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
  document.getElementById('btn-enter-demo-mode')?.addEventListener('click', () => {
    state.user = { uid: 'demo-user', email: 'owner@local-coffee.demo', isDemo: true };
    localStorage.setItem('stocksense_demo_user', JSON.stringify(state.user));
    hideAuthModal();
    updateUserDisplay();
    showToast('Entered local interactive demo mode!', 'success');
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;

  // Update nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    if (pane.id === `tab-${tabId}`) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Update header title
  const titles = {
    dashboard: 'Dashboard',
    products: 'Products & Stock Levels',
    sales: 'Sales Transactions',
    reorders: 'Reorder Forecast & Quantitative Analysis',
    orders: 'Supplier Purchase Orders',
    suppliers: 'Supplier Directory',
    settings: 'Alert Channels & Settings',
    deployment: 'Firebase Architecture & Deployment'
  };
  const heading = document.getElementById('page-heading');
  if (heading && titles[tabId]) {
    heading.textContent = titles[tabId];
  }

  // Close mobile sidebar
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');

  // Trigger chart re-render if switching to dashboard
  if (tabId === 'dashboard') {
    setTimeout(renderSalesTrendChart, 50);
  }
}

// ============================================================================
// 10. FORM SUBMISSIONS & CRUD CONTROLLERS
// ============================================================================

async function handleProductFormSubmit(e) {
  e.preventDefault();
  const idInput = document.getElementById('product-form-id').value;
  const name = document.getElementById('prod-name').value.trim();
  const sku = document.getElementById('prod-sku').value.trim();
  const category = document.getElementById('prod-category').value.trim();
  const quantity = Number(document.getElementById('prod-quantity').value);
  const unitPrice = Number(document.getElementById('prod-unit-price').value);
  const costPrice = Number(document.getElementById('prod-cost-price').value);
  const reorderLevel = Number(document.getElementById('prod-reorder-level').value);
  const supplierId = document.getElementById('prod-supplier-select').value;

  const supplier = state.suppliers.find(s => s.id === supplierId);
  const supplierName = supplier ? supplier.name : 'General Supplier';

  const productData = {
    name,
    sku,
    category,
    quantity,
    unitPrice,
    costPrice,
    reorderLevel,
    supplierId,
    supplierName,
    updatedAt: new Date().toISOString()
  };

  if (idInput) {
    // Edit existing
    const idx = state.products.findIndex(p => p.id === idInput);
    if (idx !== -1) {
      state.products[idx] = { ...state.products[idx], ...productData };
      if (state.isFirebaseActive && state.user && !state.user.isDemo) {
        await updateDoc(doc(db, `users/${state.user.uid}/products/${idInput}`), productData);
      }
      showToast(`Updated product "${name}"`, 'success');
    }
  } else {
    // Add new
    const newId = 'prod-' + Date.now();
    const newProduct = {
      id: newId,
      ...productData,
      createdAt: new Date().toISOString()
    };
    state.products.push(newProduct);

    if (state.isFirebaseActive && state.user && !state.user.isDemo) {
      await setDoc(doc(db, `users/${state.user.uid}/products/${newId}`), newProduct);
    }
    showToast(`Added product "${name}"`, 'success');
  }

  saveDataToStorage();
  closeModal('modal-product');
  refreshAllViews();
}

async function handleSaleFormSubmit(e) {
  e.preventDefault();
  const productId = document.getElementById('sale-product-select').value;
  const quantity = Number(document.getElementById('sale-quantity').value);
  const date = document.getElementById('sale-date').value;
  const notes = document.getElementById('sale-notes').value.trim();

  try {
    await processSaleTransaction({ productId, quantity, date, notes });
    closeModal('modal-sale');
    showToast(`Sale recorded successfully! Deducted ${quantity} units from inventory.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSupplierFormSubmit(e) {
  e.preventDefault();
  const idInput = document.getElementById('supplier-form-id').value;
  const name = document.getElementById('sup-name').value.trim();
  const email = document.getElementById('sup-email').value.trim();
  const phone = document.getElementById('sup-phone').value.trim();
  const whatsapp = document.getElementById('sup-whatsapp').value.trim();
  const leadTimeDays = Number(document.getElementById('sup-lead-time').value);
  const notes = document.getElementById('sup-notes').value.trim();

  const supplierData = {
    name,
    email,
    phone,
    whatsapp,
    leadTimeDays,
    notes,
    updatedAt: new Date().toISOString()
  };

  if (idInput) {
    const idx = state.suppliers.findIndex(s => s.id === idInput);
    if (idx !== -1) {
      state.suppliers[idx] = { ...state.suppliers[idx], ...supplierData };
      if (state.isFirebaseActive && state.user && !state.user.isDemo) {
        await updateDoc(doc(db, `users/${state.user.uid}/suppliers/${idInput}`), supplierData);
      }
      showToast(`Supplier "${name}" updated`, 'success');
    }
  } else {
    const newId = 'sup-' + Date.now();
    const newSupplier = {
      id: newId,
      ...supplierData,
      createdAt: new Date().toISOString()
    };
    state.suppliers.push(newSupplier);

    if (state.isFirebaseActive && state.user && !state.user.isDemo) {
      await setDoc(doc(db, `users/${state.user.uid}/suppliers/${newId}`), newSupplier);
    }
    showToast(`Supplier "${name}" created`, 'success');
  }

  saveDataToStorage();
  closeModal('modal-supplier');
  refreshAllViews();
}

async function handlePurchaseOrderSubmit(e) {
  e.preventDefault();
  const productId = document.getElementById('po-product-select').value;
  const supplierId = document.getElementById('po-supplier-id').value;
  const supplierName = document.getElementById('po-supplier-name').value;
  const quantity = Number(document.getElementById('po-quantity').value);
  const unitCost = Number(document.getElementById('po-unit-cost').value);
  const expectedDelivery = document.getElementById('po-expected-date').value;

  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  const orderNum = 'PO-' + new Date().getFullYear() + '-' + Math.floor(100 + Math.random() * 900);
  const totalCost = quantity * unitCost;

  const newPO = {
    id: 'po-' + Date.now(),
    orderNumber: orderNum,
    productId,
    productName: product.name,
    supplierId,
    supplierName,
    quantity,
    unitCost,
    totalCost,
    expectedDelivery,
    status: 'Pending',
    createdAt: new Date().toISOString()
  };

  state.purchaseOrders.unshift(newPO);

  if (state.isFirebaseActive && state.user && !state.user.isDemo) {
    await setDoc(doc(db, `users/${state.user.uid}/purchaseOrders/${newPO.id}`), newPO);
  }

  saveDataToStorage();
  closeModal('modal-purchase-order');
  refreshAllViews();
  showToast(`Purchase Order ${orderNum} issued to ${supplierName}!`, 'success');
}

async function handleStockAdjustmentSubmit(e) {
  e.preventDefault();
  const prodId = document.getElementById('adjust-product-id').value;
  const newQty = Number(document.getElementById('adjust-new-qty').value);
  const reason = document.getElementById('adjust-reason').value;

  const prod = state.products.find(p => p.id === prodId);
  if (!prod) return;

  const oldQty = prod.quantity;
  prod.quantity = newQty;
  prod.updatedAt = new Date().toISOString();

  if (state.isFirebaseActive && state.user && !state.user.isDemo) {
    await updateDoc(doc(db, `users/${state.user.uid}/products/${prodId}`), {
      quantity: newQty,
      updatedAt: prod.updatedAt
    });
  }

  saveDataToStorage();
  closeModal('modal-adjust-stock');
  refreshAllViews();
  showToast(`Adjusted "${prod.name}" from ${oldQty} to ${newQty} units (${reason}).`, 'info');
}

async function handleSettingsFormSubmit(e) {
  e.preventDefault();
  state.settings.alertEmail = document.getElementById('setting-alert-email').value.trim();
  state.settings.alertPhone = document.getElementById('setting-alert-phone').value.trim();
  state.settings.alertWhatsapp = document.getElementById('setting-alert-whatsapp').value.trim();
  state.settings.emailEnabled = document.getElementById('setting-enable-email').checked;
  state.settings.smsEnabled = document.getElementById('setting-enable-sms').checked;
  state.settings.whatsappEnabled = document.getElementById('setting-enable-whatsapp').checked;
  state.settings.inAppEnabled = document.getElementById('setting-enable-inapp').checked;
  state.settings.safetyStockPercent = Number(document.getElementById('setting-safety-stock').value) || 20;

  if (state.isFirebaseActive && state.user && !state.user.isDemo) {
    await setDoc(doc(db, `users/${state.user.uid}/settings/notifications`), {
      ...state.settings,
      updatedAt: new Date().toISOString()
    });
  }

  saveDataToStorage();
  refreshAllViews();
  showToast('Notification channels & safety thresholds saved!', 'success');
}

// ============================================================================
// 11. DELEGATED ACTIONS (BUTTON CLICKS IN DYNAMIC TABLES)
// ============================================================================

function handleDelegatedTableClicks(e) {
  const target = e.target;

  // 1. Quick Reorder button (from dashboard or reorder table)
  const reorderBtn = target.closest('.btn-quick-reorder');
  if (reorderBtn) {
    const prodId = reorderBtn.getAttribute('data-prod-id');
    const suggestedQty = Number(reorderBtn.getAttribute('data-suggested-qty') || 20);
    openPurchaseOrderModal(prodId, suggestedQty);
    return;
  }

  // 2. Adjust Stock button
  const adjustBtn = target.closest('.btn-adjust-stock');
  if (adjustBtn) {
    const prodId = adjustBtn.getAttribute('data-id');
    const prod = state.products.find(p => p.id === prodId);
    if (prod) {
      document.getElementById('adjust-product-id').value = prod.id;
      document.getElementById('adjust-product-name').textContent = `${prod.name} (${prod.sku})`;
      document.getElementById('adjust-current-qty').value = `${prod.quantity} units`;
      document.getElementById('adjust-new-qty').value = prod.quantity;
      openModal('modal-adjust-stock');
    }
    return;
  }

  // 3. Edit Product
  const editProdBtn = target.closest('.btn-edit-product');
  if (editProdBtn) {
    const prodId = editProdBtn.getAttribute('data-id');
    const prod = state.products.find(p => p.id === prodId);
    if (prod) {
      document.getElementById('modal-product-title').textContent = 'Edit Product';
      document.getElementById('product-form-id').value = prod.id;
      document.getElementById('prod-name').value = prod.name;
      document.getElementById('prod-sku').value = prod.sku;
      document.getElementById('prod-category').value = prod.category || '';
      document.getElementById('prod-quantity').value = prod.quantity;
      document.getElementById('prod-unit-price').value = prod.unitPrice;
      document.getElementById('prod-cost-price').value = prod.costPrice;
      document.getElementById('prod-reorder-level').value = prod.reorderLevel;
      document.getElementById('prod-supplier-select').value = prod.supplierId || '';
      openModal('modal-product');
    }
    return;
  }

  // 4. Delete Product
  const delProdBtn = target.closest('.btn-delete-product');
  if (delProdBtn) {
    const prodId = delProdBtn.getAttribute('data-id');
    const prod = state.products.find(p => p.id === prodId);
    if (prod && confirm(`Delete "${prod.name}" from inventory?`)) {
      state.products = state.products.filter(p => p.id !== prodId);
      if (state.isFirebaseActive && state.user && !state.user.isDemo) {
        deleteDoc(doc(db, `users/${state.user.uid}/products/${prodId}`));
      }
      saveDataToStorage();
      refreshAllViews();
      showToast(`Deleted product "${prod.name}"`, 'info');
    }
    return;
  }

  // 5. Purchase Order Statuses
  const markRecBtn = target.closest('.btn-mark-received');
  if (markRecBtn) {
    const poId = markRecBtn.getAttribute('data-id');
    updatePurchaseOrderStatus(poId, 'Received');
    return;
  }

  const markShipBtn = target.closest('.btn-mark-shipped');
  if (markShipBtn) {
    const poId = markShipBtn.getAttribute('data-id');
    updatePurchaseOrderStatus(poId, 'Shipped');
    return;
  }

  // 6. Edit Supplier
  const editSupBtn = target.closest('.btn-edit-supplier');
  if (editSupBtn) {
    const supId = editSupBtn.getAttribute('data-id');
    const sup = state.suppliers.find(s => s.id === supId);
    if (sup) {
      document.getElementById('modal-supplier-title').textContent = 'Edit Supplier';
      document.getElementById('supplier-form-id').value = sup.id;
      document.getElementById('sup-name').value = sup.name;
      document.getElementById('sup-email').value = sup.email;
      document.getElementById('sup-phone').value = sup.phone || '';
      document.getElementById('sup-whatsapp').value = sup.whatsapp || '';
      document.getElementById('sup-lead-time').value = sup.leadTimeDays;
      document.getElementById('sup-notes').value = sup.notes || '';
      openModal('modal-supplier');
    }
    return;
  }

  // 7. Delete Supplier
  const delSupBtn = target.closest('.btn-delete-supplier');
  if (delSupBtn) {
    const supId = delSupBtn.getAttribute('data-id');
    const sup = state.suppliers.find(s => s.id === supId);
    if (sup && confirm(`Remove supplier "${sup.name}"?`)) {
      state.suppliers = state.suppliers.filter(s => s.id !== supId);
      if (state.isFirebaseActive && state.user && !state.user.isDemo) {
        deleteDoc(doc(db, `users/${state.user.uid}/suppliers/${supId}`));
      }
      saveDataToStorage();
      refreshAllViews();
      showToast(`Supplier "${sup.name}" removed`, 'info');
    }
    return;
  }

  // 8. Dismiss Alert
  const dismissAlertBtn = target.closest('.btn-dismiss-alert');
  if (dismissAlertBtn) {
    const alertId = dismissAlertBtn.getAttribute('data-id');
    const alert = state.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'dismissed';
      if (state.isFirebaseActive && state.user && !state.user.isDemo) {
        updateDoc(doc(db, `users/${state.user.uid}/alerts/${alertId}`), { status: 'dismissed' });
      }
      saveDataToStorage();
      renderAlertsList();
      showToast('Alert dismissed.', 'info');
    }
    return;
  }
}

// ============================================================================
// 12. MODAL HELPERS & AUTH MODAL
// ============================================================================

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

function openAddProductModal() {
  document.getElementById('modal-product-title').textContent = 'Add New Product';
  document.getElementById('product-form-id').value = '';
  document.getElementById('prod-name').value = '';
  document.getElementById('prod-sku').value = '';
  document.getElementById('prod-category').value = '';
  document.getElementById('prod-quantity').value = '20';
  document.getElementById('prod-unit-price').value = '';
  document.getElementById('prod-cost-price').value = '';
  document.getElementById('prod-reorder-level').value = '15';
  openModal('modal-product');
}

function openAddSupplierModal() {
  document.getElementById('modal-supplier-title').textContent = 'Add Supplier';
  document.getElementById('supplier-form-id').value = '';
  document.getElementById('sup-name').value = '';
  document.getElementById('sup-email').value = '';
  document.getElementById('sup-phone').value = '';
  document.getElementById('sup-whatsapp').value = '';
  document.getElementById('sup-lead-time').value = '7';
  document.getElementById('sup-notes').value = '';
  openModal('modal-supplier');
}

function openPurchaseOrderModal(prefillProductId = null, prefillQuantity = 25) {
  updateProductDropdowns();
  const poProdSelect = document.getElementById('po-product-select');
  const poQtyInput = document.getElementById('po-quantity');

  if (prefillProductId && poProdSelect) {
    poProdSelect.value = prefillProductId;
  }
  if (poQtyInput) {
    poQtyInput.value = prefillQuantity > 0 ? prefillQuantity : 25;
  }

  // Trigger change event to fill supplier, lead time, and costs
  if (poProdSelect) {
    poProdSelect.dispatchEvent(new Event('change'));
  }
  openModal('modal-purchase-order');
}

let authMode = 'login';
function toggleAuthTabs(mode) {
  authMode = mode;
  const loginBtn = document.getElementById('auth-tab-login');
  const signupBtn = document.getElementById('auth-tab-signup');
  const submitBtn = document.getElementById('btn-auth-submit');

  if (mode === 'login') {
    loginBtn.classList.add('active');
    signupBtn.classList.remove('active');
    submitBtn.textContent = 'Sign In to StockSense';
  } else {
    signupBtn.classList.add('active');
    loginBtn.classList.remove('active');
    submitBtn.textContent = 'Create Business Account';
  }
}

function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'flex';
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();

  if (!email || !password) return;

  if (state.isFirebaseActive && auth) {
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Successfully signed in!', 'success');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        showToast('Account created successfully!', 'success');
      }
      hideAuthModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  } else {
    // In local demo mode, simulate user switch
    state.user = { uid: 'user-' + email.replace(/[^a-zA-Z0-9]/g, ''), email, isDemo: true };
    localStorage.setItem('stocksense_demo_user', JSON.stringify(state.user));
    hideAuthModal();
    updateUserDisplay();
    showToast(`Signed in locally as ${email}`, 'success');
  }
}

function handleSaveCustomFirebaseConfig() {
  const apiKey = document.getElementById('cfg-apiKey').value.trim();
  const authDomain = document.getElementById('cfg-authDomain').value.trim();
  const projectId = document.getElementById('cfg-projectId').value.trim();
  const storageBucket = document.getElementById('cfg-storageBucket').value.trim();
  const messagingSenderId = document.getElementById('cfg-messagingSenderId').value.trim();
  const appId = document.getElementById('cfg-appId').value.trim();

  if (!apiKey || !projectId) {
    showToast('Please provide at least the API Key and Project ID.', 'warning');
    return;
  }

  const customConfig = {
    apiKey,
    authDomain: authDomain || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: storageBucket || `${projectId}.appspot.com`,
    messagingSenderId: messagingSenderId || '123456789',
    appId: appId || '1:123456789:web:abcdef'
  };

  localStorage.setItem('stocksense_firebase_config', JSON.stringify(customConfig));
  showToast('Custom Firebase credentials saved! Reconnecting...', 'success');
  setTimeout(() => window.location.reload(), 500);
}

// ============================================================================
// 13. UTILITIES & TOAST NOTIFICATION SYSTEM
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  else if (type === 'error') icon = '❌';
  else if (type === 'warning') icon = '⚠️';

  toast.innerHTML = `
    <span style="font-size: 1.1rem;">${icon}</span>
    <div class="toast-message">${escapeHtml(message)}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// 14. APPLICATION BOOTSTRAP
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Set default sale date to today
  const saleDateInput = document.getElementById('sale-date');
  if (saleDateInput) {
    saleDateInput.value = new Date().toISOString().split('T')[0];
  }

  setupEventListeners();
  initializeFirebaseService();
});
