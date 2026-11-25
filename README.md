# Piekļuves

Personīgs, šifrēts paroļu seifs, kas strādā datorā un telefonā (PWA), ar automātisku rezerves kopiju un sinhronizāciju caur Google Sheets.

## Kā tas ir drošs

- Visi dati tiek šifrēti **pašā ierīcē**: AES-256-GCM, atslēga no galvenās paroles ar PBKDF2-SHA256 (600 000 iterācijas).
- Galvenā parole netiek saglabāta un netiek nekur sūtīta. **Ja to aizmirsīsi, datus atgūt nevar.**
- Google Sheets saņem tikai šifrētu bloku (tur nav redzami ne nosaukumi, ne paroles). Piekļuvi Apps Script aizsargā arī garš nejaušs token.
- Bez ārējām bibliotēkām, stingra Content-Security-Policy, automātiska aizslēgšana pēc neaktivitātes, starpliktuve tiek notīrīta pēc 30 s.
- Sheets glabā pēdējās 50 versijas, tāpēc var atgriezties pie vecākas kopijas.

## Mapju struktūra

```
app/                    lietotne (statiska web lietotne, to publicē GitHub Pages)
  index.html            ekrāni un dialogi
  styles.css            above.lv stils (akcents: misiņa #C8A95C)
  js/app.js             UI, aizslēgšana, sinhronizācija
  js/crypto.js          šifrēšana (WebCrypto)
  js/vault.js           datu modelis, apvienošana, CSV imports
  js/generator.js       paroļu ģenerators
  js/sheets.js          savienojums ar Google Apps Script
  sw.js, manifest.webmanifest   bezsaistes režīms un “instalēšana” telefonā
google-apps-script/Code.gs      kods, ko ielīmē Google Sheets (Apps Script)
tests/                  node testi (šifrēšana, apvienošana, CSV, ģenerators)
.github/workflows/pages.yml     automātiska publicēšana uz GitHub Pages
```

## Palaišana lokāli

```
cd app && python3 -m http.server 5193
```
Atver http://localhost:5193. Testi: `node --test tests/`.

## 1. Publicēšana ar GitHub (lai strādā arī telefonā)

1. GitHub izveido jaunu repozitoriju (var būt publisks: kodā nav nekādu noslēpumu, dati repozitorijā nenonāk).
2. Iepušo šo projektu uz `main` zaru.
3. Repozitorijā: **Settings → Pages → Source: GitHub Actions**.
4. Pēc ~1 min lietotne būs pieejama `https://<lietotājvārds>.github.io/<repo>/`.
5. Telefonā atver šo adresi → **Kopīgot → Pievienot sākuma ekrānam** (iPhone) vai **Instalēt lietotni** (Android). Datorā Chrome adreses joslā → **Instalēt**.

Svarīgi: iPhone obligāti pievieno sākuma ekrānam, jo Safari pārlūka dati var tikt dzēsti, ja vietni ilgi neapmeklē. Sheets kopija tāpat paliek.

## 2. Google Sheets rezerves kopija

1. Izveido jaunu Google Sheets dokumentu (piem. “Piekļuves backup”).
2. **Paplašinājumi → Apps Script**, izdzēs esošo kodu un ielīmē `google-apps-script/Code.gs` saturu. Saglabā.
3. Augšā izvēlies funkciju **setup** → **Palaist** → atļauj piekļuvi. Žurnālā (Execution log) parādīsies **token**: nokopē to.
4. **Izvietot → Jauns izvietojums → Tīmekļa lietotne**: Izpildīt kā: *Es*, Piekļuve: *Ikviens*. Nokopē saiti, kas beidzas ar `/exec`.
5. Lietotnē: **Iestatījumi → Google Sheets** → ielīmē saiti un token → **Saglabāt un pārbaudīt**.

Otrā ierīcē: pirmajā ekrānā **Atjaunot no Google Sheets** → tā pati saite, token un galvenā parole. Turpmāk abas ierīces sinhronizējas automātiski (katrs ieraksts apvienojas pēc jaunākās izmaiņas, arī dzēšana).

## Imports

Iestatījumi → **Importēt CSV**: der eksports no Chrome / Google paroļu pārvaldnieka, Bitwarden, 1Password u.c. (vajag kolonnu `password`). Pēc importa CSV failu izdzēs, jo tas nav šifrēts.
