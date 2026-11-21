# Revize – terénní checklist (PWA pro iPhone)

Webová aplikace, která v terénu vytvoří checklist **CL-A4-02** jako JSON. Program na PC ho
načte přes **Připojit JSON…** a zobrazí stejný kontrolní náhled jako u fotografie checklistu.

- Funguje offline (service worker). Seznam objektů i rozpracované checklisty jsou jen v telefonu.
- Seznam objektů: v programu **Lhůtník › Export pro telefon…**, ulož do OneDrive, v aplikaci **Načíst seznam**.
- Hotový checklist: **Zkontrolovat a uložit JSON › Uložit / sdílet › Uložit do Souborů** (OneDrive).
- V iPhonu: otevři adresu aplikace v Safari › Sdílet › **Přidat na plochu**.

Aplikace musí běžet z adresy **https://** (jinak iPhone nepovolí offline režim). Složka obsahuje jen
kód, žádná data zákazníků. Nová verze: zvyš `CACHE` v `sw.js` a `APP_VERSION` v `app.js`.

Místní vyzkoušení na PC: `.venv\Scripts\python.exe -m http.server 8765 --directory pwa`
a otevřít `http://localhost:8765`.
