/**
 * StockSense - Firebase Client Configuration
 * 
 * Replace the placeholder values below with your Firebase Web App credentials
 * obtained from the Firebase Console (Project Settings > General > Your apps > Web app).
 * 
 * You can also enter these keys interactively via the "Firebase Setup" button in the app UI,
 * which persists them to your browser session without touching code!
 */

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
  // Optional databaseId if using named Firestore database
  firestoreDatabaseId: "(default)"
};

/**
 * Checks whether the current firebaseConfig contains actual credentials
 * or placeholder text.
 */
export function isPlaceholderConfig(config = firebaseConfig) {
  if (!config || !config.apiKey) return true;
  return (
    config.apiKey.includes("YOUR_API_KEY") ||
    config.projectId.includes("your-project-id") ||
    config.apiKey.trim() === ""
  );
}

/**
 * Retrieves stored config from localStorage if the user entered their own keys in the UI
 */
export function getActiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem("stocksense_firebase_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!isPlaceholderConfig(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read custom Firebase config from localStorage", e);
  }
  return firebaseConfig;
}
