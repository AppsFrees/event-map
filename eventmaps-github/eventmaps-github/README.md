# EventMaps

PWA de mapa de negocios y eventos locales con Firebase. Todo funciona en planes gratuitos: Firebase Spark (sin tarjeta), GitHub Pages y GitHub Actions.

Publicada en: https://appsfrees.github.io/eventmaps/

## Arquitectura

- `index.html`: interfaz (Tailwind + Leaflet), accesible (roles ARIA, foco visible, salto al contenido) y con tema claro/oscuro/sistema.
- `app.js`: lógica de la app (módulo ES, Firebase JS SDK 13.3.0 desde gstatic).
- `firebase-config.js`: configuración pública del proyecto `eventmaps-d8df2` y ajustes (`appCheckSiteKey`, `vapidKey`).
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`: configuración de Firebase.
- `service-worker.js`: caché sin conexión, notificaciones push y apertura de la app al tocarlas.
- `.github/workflows/notificaciones.yml` y `scripts/notify/send.mjs`: envío programado de notificaciones push (reemplaza a Cloud Functions).

## Colecciones Firestore

| Colección | Contenido |
|---|---|
| `users/{uid}` | perfil y `role` (`user`, `business`, `admin`) |
| `users/{uid}/favorites/{businessId}` | favoritos por cuenta |
| `users/{uid}/agenda/{eventId}` | eventos guardados (calendario y recordatorios) |
| `users/{uid}/pushTokens/{token}` | dispositivos registrados para notificaciones push |
| `categories/{id}` | categorías administrables |
| `businesses/{id}` | negocios; `status`: `pending` / `approved` / `rejected` |
| `events/{id}` | eventos; requieren aprobación y vuelven a `pending` al editarse |
| `reviews/{businessId_uid}` | una reseña por usuario y negocio; `verified` si asistió a un evento ya iniciado |
| `businessPhotos/{id}` | fotos del negocio comprimidas (sin Cloud Storage) |
| `stats/{businessId}` | contadores de vistas, rutas, llamadas, WhatsApp y favoritos |

## Roles

- Usuario: favoritos, agenda, reseñas, notificaciones.
- Negocio: registra negocios (quedan pendientes), gestiona fotos, eventos y ve estadísticas.
- Admin: panel con resumen, moderación de negocios/eventos/reseñas, usuarios y roles, categorías y carga de datos iniciales.

### Crear el primer administrador

1. Inicia sesión en la app (correo o Google).
2. En la consola de Firebase, Firestore → `users` → tu documento → cambia `role` a `admin`.
3. Recarga la app: aparece el Panel admin. En la pestaña Datos puedes cargar los datos iniciales de ejemplo.

## Servicios y costo

| Necesidad | Solución gratuita |
|---|---|
| Base de datos | Cloud Firestore, cuota gratuita Spark (1 GiB, 50.000 lecturas y 20.000 escrituras al día) |
| Inicio de sesión | Firebase Authentication (correo y Google) |
| Fotos | Comprimidas en el navegador y guardadas en Firestore (`businessPhotos`), máx. ~900 KB por negocio. Cloud Storage exige el plan Blaze, por eso no se usa |
| Notificaciones push | Firebase Cloud Messaging (gratis) + GitHub Actions cada 30 minutos (gratis en repositorios públicos), en lugar de Cloud Functions |
| Protección contra bots | App Check con reCAPTCHA (Fraud Defense, nivel Essentials: 10.000 verificaciones al mes gratis) |
| Analítica | Google Analytics for Firebase |
| Hosting | GitHub Pages |

## Notificaciones push

1. La clave pública VAPID ya está en `firebase-config.js`.
2. En Firebase → Configuración del proyecto → Cuentas de servicio → "Generar nueva clave privada" (descarga un JSON).
3. En GitHub → Settings → Secrets and variables → Actions → New repository secret: nombre `FIREBASE_SERVICE_ACCOUNT`, valor = contenido completo del JSON. Luego borra el archivo descargado.
4. En la pestaña Actions puedes ejecutar "Notificaciones push" manualmente (con "Solo simular" para probar).

El proceso avisa a quienes tienen un negocio en favoritos cuando se aprueba un evento nuevo, y recuerda los eventos guardados en la agenda cuando faltan menos de 24 horas. GitHub puede retrasar unos minutos las ejecuciones programadas.

## App Check

1. Google Cloud → Seguridad → Fraud Defense: activa la API de reCAPTCHA y crea una clave Web con el dominio `appsfrees.github.io` (sin facturación queda en el nivel gratuito Essentials).
2. Firebase → App Check → app web → proveedor reCAPTCHA (Fraud Defense): pega la clave de sitio y guarda.
3. Copia la clave de sitio en `appCheckSiteKey` de `firebase-config.js`.
4. Revisa las métricas unos días antes de activar la aplicación obligatoria. Si se superan las 10.000 verificaciones del mes, reCAPTCHA responde con error hasta el mes siguiente; con la aplicación obligatoria activa, eso bloquearía la app.

## Despliegue de reglas

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

## Limitaciones conocidas

- iPhone/iPad solo reciben notificaciones push si la app está instalada en la pantalla de inicio (iOS 16.4 o superior).
- Los límites de eventos por plan se aplican en la app; como todo evento pasa por moderación, el admin puede rechazar los que excedan el plan.
- La búsqueda de direcciones usa Nominatim (OpenStreetMap), con límite de uso razonable.
