# Piekļuves: paveiktais

Kas izdarīts un kā (jaunākais apakšā).

- 2026-11-25: Izveidota lietotne “Piekļuves”: PWA paroļu seifs (app/), šifrēšana klientā (WebCrypto AES-GCM + PBKDF2 600k), Google Sheets kopija/sinhronizācija caur Apps Script (google-apps-script/Code.gs, token, pēdējās 50 versijas, ierakstu apvienošana pēc updatedAt ar dzēšanas “tombstones”), paroļu ģenerators, CSV/JSON imports, šifrēts eksports, auto-lock, GitHub Pages workflow. Testi: `node --test tests/`; lokāli: `cd app && python3 -m http.server 5193`. E2E pārbaudīts ar Playwright (2 ierīces + mock Sheets).
