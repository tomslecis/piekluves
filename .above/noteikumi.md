# Piekļuves: noteikumi un stils

Claude ievēro šo failu katrā šī projekta čatā. To var labot pats vai lūgt čatā (“atceries šim projektam …”).

## Par projektu
Personīgs šifrēts paroļu seifs (PWA datoram un telefonam), rezerves kopija un sinhronizācija caur Google Sheets (Apps Script), hostēts GitHub Pages.

## Stils
above.lv tumšais stils, akcents misiņa #C8A95C, ikona: atslēga uz olīva fona.

## Drošība (nemainīt bez lietotāja ziņas)
- Viss šifrēts klientā (AES-256-GCM, PBKDF2 600k); uz Sheets/GitHub nekad nesūta atklātus datus vai galveno paroli.
- Bez ārējām bibliotēkām/CDN; stingra CSP; neizmantot innerHTML ar lietotāja datiem.

## Noteikumi
