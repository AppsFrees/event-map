// Configuración web pública del proyecto Firebase "Eventmaps".
// Estos valores pueden ser públicos: el acceso real se protege con
// Authentication, reglas de seguridad y App Check.
export const firebaseConfig = {
  apiKey: 'AIzaSyA3E0zuo8DZg1JM9H15PZ0PNs3o9pgFxTU',
  authDomain: 'eventmaps-d8df2.firebaseapp.com',
  projectId: 'eventmaps-d8df2',
  storageBucket: 'eventmaps-d8df2.firebasestorage.app',
  messagingSenderId: '1000740357054',
  appId: '1:1000740357054:web:19835cc2dbfb2aa3beafef',
  measurementId: 'G-YP86FF064V'
};

// Todo funciona en el plan gratuito Spark (sin Cloud Storage ni Cloud Functions).
export const appSettings = {
  // Clave de sitio de reCAPTCHA (Fraud Defense, nivel gratuito Essentials) para App Check. Vacía = App Check desactivado.
  appCheckSiteKey: '',
  // Clave pública VAPID de Cloud Messaging (Configuración del proyecto > Cloud Messaging > Certificados web push).
  vapidKey: 'BOIM4vIaiE6-mM3Mu57_tcs1dYJ-oDupsyFrLqOzHBTVgs80ak0ZFYcRnQhYv1L2zmsujz5pQRn_sQ7VCmkBXN0'
};
