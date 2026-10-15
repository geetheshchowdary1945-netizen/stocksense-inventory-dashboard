/**
 * StockSense - Cloud Functions for Automated Inventory Alerts
 * 
 * Trigger: On Firestore Product update at users/{userId}/products/{productId}
 * - Checks if product quantity drops below or to the reorder level
 * - Creates an in-app Alert document under users/{userId}/alerts
 * - Sends Email via Nodemailer / SMTP (if configured in env)
 * - Sends SMS / WhatsApp via Twilio (if configured in env)
 * - Safe fallback: logs status and maintains in-app notification if API keys are absent
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Optional notification libraries (handled safely if missing)
let nodemailer = null;
let twilio = null;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  console.log("nodemailer not loaded; will log emails to console.");
}

try {
  twilio = require("twilio");
} catch (e) {
  console.log("twilio not loaded; will log SMS/WhatsApp to console.");
}

/**
 * Cloud Function triggered on product changes in users/{userId}/products/{productId}
 */
exports.checkProductInventoryAlerts = functions.firestore
  .document("users/{userId}/products/{productId}")
  .onUpdate(async (change, context) => {
    const { userId, productId } = context.params;
    const beforeData = change.before.data() || {};
    const afterData = change.after.data() || {};

    const prevQty = Number(beforeData.quantity ?? 0);
    const newQty = Number(afterData.quantity ?? 0);
    const reorderLevel = Number(afterData.reorderLevel ?? 0);
    const productName = afterData.name || "Product";
    const sku = afterData.sku || "N/A";

    console.log(`[StockSense Trigger] Checking product ${productName} (${productId}) for user ${userId}. Prev: ${prevQty}, New: ${newQty}, ReorderLevel: ${reorderLevel}`);

    // Check if stock just fell to or below reorder level, or if currently zero
    const isNowLowStock = newQty <= reorderLevel && (prevQty > reorderLevel || newQty === 0);
    const isOutOfStock = newQty === 0;

    if (!isNowLowStock && !isOutOfStock) {
      console.log(`[StockSense Trigger] No alert required for ${productName}. Stock is adequate.`);
      return null;
    }

    const alertType = isOutOfStock ? "out_of_stock" : "low_stock";
    const severity = isOutOfStock ? "danger" : "warning";
    const message = isOutOfStock
      ? `🚨 OUT OF STOCK: "${productName}" (SKU: ${sku}) is completely depleted (0 units remaining). Immediate reorder required!`
      : `⚠️ LOW STOCK ALERT: "${productName}" (SKU: ${sku}) has fallen to ${newQty} units (Reorder point: ${reorderLevel}).`;

    // 1. Create In-App Alert in Firestore
    const alertDocRef = db.collection("users").doc(userId).collection("alerts").doc();
    await alertDocRef.set({
      id: alertDocRef.id,
      type: alertType,
      productId: productId,
      productName: productName,
      sku: sku,
      currentQuantity: newQty,
      reorderLevel: reorderLevel,
      severity: severity,
      message: message,
      status: "unread",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[StockSense Alert] Created in-app alert ${alertDocRef.id} for user ${userId}`);

    // 2. Load User Notification Preferences
    let settings = {
      alertEmail: "",
      alertPhone: "",
      alertWhatsapp: "",
      emailEnabled: true,
      smsEnabled: false,
      whatsappEnabled: false,
      inAppEnabled: true
    };

    try {
      const settingsDoc = await db.collection("users").doc(userId).collection("settings").doc("notifications").get();
      if (settingsDoc.exists) {
        settings = { ...settings, ...settingsDoc.data() };
      }
    } catch (err) {
      console.warn("[StockSense Settings] Could not load settings; using default email/in-app", err.message);
    }

    // 3. Dispatch Email Notification (Nodemailer / SMTP)
    const smtpHost = process.env.SMTP_HOST || functions.config()?.smtp?.host;
    const smtpUser = process.env.SMTP_USER || functions.config()?.smtp?.user;
    const smtpPass = process.env.SMTP_PASS || functions.config()?.smtp?.pass;
    const recipientEmail = settings.alertEmail || null;

    if (settings.emailEnabled && recipientEmail) {
      if (nodemailer && smtpHost && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: Number(process.env.SMTP_PORT || functions.config()?.smtp?.port || 587),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: smtpUser, pass: smtpPass }
          });

          await transporter.sendMail({
            from: `"StockSense Alerts" <${smtpUser}>`,
            to: recipientEmail,
            subject: `[StockSense Alert] ${isOutOfStock ? "CRITICAL: Out of Stock" : "Low Stock"}: ${productName}`,
            text: `${message}\n\nPlease log in to your StockSense dashboard to generate a Purchase Order with your supplier.`,
            html: `
              <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                <h2 style="color: ${isOutOfStock ? '#dc2626' : '#d97706'};">StockSense Inventory Alert</h2>
                <p><strong>${message}</strong></p>
                <table style="border-collapse: collapse; margin-top: 12px; width: 100%; max-width: 400px;">
                  <tr><td style="padding: 6px; border: 1px solid #cbd5e1;">Product:</td><td style="padding: 6px; border: 1px solid #cbd5e1;">${productName}</td></tr>
                  <tr><td style="padding: 6px; border: 1px solid #cbd5e1;">SKU:</td><td style="padding: 6px; border: 1px solid #cbd5e1;">${sku}</td></tr>
                  <tr><td style="padding: 6px; border: 1px solid #cbd5e1;">Current Units:</td><td style="padding: 6px; border: 1px solid #cbd5e1;">${newQty}</td></tr>
                  <tr><td style="padding: 6px; border: 1px solid #cbd5e1;">Reorder Point:</td><td style="padding: 6px; border: 1px solid #cbd5e1;">${reorderLevel}</td></tr>
                </table>
                <p style="margin-top: 18px;">Automated notification sent by StockSense.</p>
              </div>
            `
          });
          console.log(`[StockSense Email] Successfully sent email alert to ${recipientEmail}`);
        } catch (emailErr) {
          console.error("[StockSense Email] Error sending email via Nodemailer:", emailErr.message);
        }
      } else {
        console.log(`[StockSense Email Fallback] SMTP credentials not configured in env. Alert logged for email ${recipientEmail}: "${message}"`);
      }
    }

    // 4. Dispatch SMS / WhatsApp via Twilio
    const twilioSid = process.env.TWILIO_ACCOUNT_SID || functions.config()?.twilio?.sid;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN || functions.config()?.twilio?.token;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER || functions.config()?.twilio?.phone;
    const twilioWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || functions.config()?.twilio?.whatsapp;

    if (twilio && twilioSid && twilioToken) {
      const client = twilio(twilioSid, twilioToken);

      // SMS
      if (settings.smsEnabled && settings.alertPhone && twilioPhone) {
        try {
          await client.messages.create({
            body: `[StockSense] ${message}`,
            from: twilioPhone,
            to: settings.alertPhone
          });
          console.log(`[StockSense SMS] Sent SMS alert to ${settings.alertPhone}`);
        } catch (smsErr) {
          console.error("[StockSense SMS] Twilio SMS failed:", smsErr.message);
        }
      }

      // WhatsApp
      if (settings.whatsappEnabled && settings.alertWhatsapp && twilioWhatsApp) {
        try {
          await client.messages.create({
            body: `[StockSense] ${message}`,
            from: `whatsapp:${twilioWhatsApp}`,
            to: `whatsapp:${settings.alertWhatsapp}`
          });
          console.log(`[StockSense WhatsApp] Sent WhatsApp alert to ${settings.alertWhatsapp}`);
        } catch (waErr) {
          console.error("[StockSense WhatsApp] Twilio WhatsApp failed:", waErr.message);
        }
      }
    } else {
      if (settings.smsEnabled || settings.whatsappEnabled) {
        console.log(`[StockSense Twilio Fallback] Twilio API credentials not configured in Secret Manager/Env. In-app alerts remain active.`);
      }
    }

    return { success: true, alertId: alertDocRef.id };
  });
