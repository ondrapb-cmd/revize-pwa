# Revize – terénní checklist (PWA pro iPhone)

Webová aplikace, která v terénu vytvoří checklist **CL-A4-02** jako JSON. Program na PC ho
načte přes **Připojit JSON…** a zobrazí stejný kontrolní náhled jako u fotografie checklistu.
Adresa aplikace: **https://ondrapb-cmd.github.io/revize-pwa/**

- Funguje offline (service worker). Seznam objektů i rozpracované checklisty jsou jen v telefonu.
- Přes telefon se řeší jednodušší objekty; ostatní objekty odeber ze seznamu červeným **✕**.

---

## Postup práce

### Jednou na začátku

**PC:** v OneDrive založ složku pro výměnu s telefonem, např. `PRÁCE\Lhutník\Telefon`.

**iPhone:**
1. Nainstaluj z App Store aplikaci **OneDrive** a přihlas se.
2. Aplikace **Soubory › Procházet › ⋯ › Upravit** → zapni **OneDrive** (jinak ho Revize při výběru souboru nevidí).
3. V Safari otevři adresu aplikace › **Sdílet › Přidat na plochu**. Dál spouštěj jen ikonou z plochy.

### Před výjezdem (PC → telefon)

1. V programu **Lhůtník** nastav období (např. měsíc), případně zaškrtni jen vybrané objekty.
2. **Export pro telefon…** → ulož do `OneDrive\PRÁCE\Lhutník\Telefon`.
   Export načte i **evidenci hasicích přístrojů** každého objektu (trvá to desítky sekund, ukazuje průběh).
3. V telefonu: **Revize › Načíst seznam › Procházet › OneDrive › Telefon** → vyber soubor.
   Seznam zůstane v telefonu a funguje i bez signálu.

### Na místě (offline)

1. Najdi objekt (hledání / filtr termínů) › **Nový checklist**. Objekt mimo seznam: **+ Objekt mimo seznam**.
2. U každé části zvol **Beze změn / Změny / Netýká se**.
3. **B – Hasicí přístroje:** zobrazí se přístroje z posledního protokolu s automatickým stavem
   (dobrý · příští TZ, letos TZ, konec životnosti). U každého přístroje:
   - **Auto** – nic nezapisuješ, program na PC stav spočítá sám (TZ v termínu, konec životnosti),
   - **TZ / Oprava** – provedeno letos,
   - **Vyřadit** – přístroj vyřazen,
   - **Výměna** – vyřazen a nahrazen novým (vyplň výrobní číslo `číslo/XX`, druh, výrobce, model).
   - **+ Nový přístroj** – další přístroj navíc (výrobní číslo `číslo/XX`, rok výroby, umístění).
4. Rozpracovaný checklist se průběžně ukládá v telefonu – aplikaci můžeš kdykoli zavřít.
5. **Zkontrolovat a uložit JSON** – aplikace vypíše, co chybí (stejná pravidla jako program na PC).

### Uložení (telefon → PC)

1. **Uložit / sdílet › Uložit do Souborů › OneDrive › Telefon › Uložit.** Checklist dostane štítek *uloženo*.
2. Když „Uložit do Souborů“ chybí: **Stáhnout** → soubor je v Soubory › Stažené, odtud ho přesuň do OneDrive.

### Zpracování na PC

1. Počkej, až OneDrive stáhne `checklist_<datum>_<adresa>.json`.
2. **Pracovní dávka** › vyber objekt › **3. Podklady › Připojit JSON…** → kontrolní náhled.
3. Dál obvyklý postup (příprava, náhled změn, zápis). Změny PHP z telefonu se zapíší stejně
   jako z tabulky PHP v programu.

### Úklid seznamu

- Červené **✕ u checklistu** – smaže checklist z telefonu (u neuloženého varuje).
- Červené **✕ u objektu** – odebere objekt ze seznamu (vyřízený jinak než telefonem).
  Najdeš ho dole v **Odebrané objekty** › *Vrátit do seznamu*. Při novém termínu (další rok)
  se objekt v seznamu objeví sám.

### Na co si dát pozor

- **Ikonu Revize z plochy nemaž** – smažou se i neuložené checklisty.
- V Safari nepoužívej **Vymazat historii a data** (ze stejného důvodu).
- Hotový checklist ukládej do OneDrive hned (nejpozději večer).
- Občas **O aplikaci a zálohy › Záloha všech checklistů** a soubor ulož do OneDrive.
- Po změně kontaktů nebo období na PC seznam nahraj znovu – rozpracované checklisty zůstanou.
- Evidence PHP v seznamu je z doby exportu. Když mezitím na PC zapíšeš PHP téhož objektu, udělej nový export.
- Internet je potřeba jen pro stažení nové verze aplikace.

---

## Pro vývoj

Aplikace musí běžet z adresy **https://** (jinak iPhone nepovolí offline režim). Složka obsahuje jen
kód, žádná data zákazníků – exporty seznamu sem nikdy neukládej.
Nová verze: zvyš `CACHE` v `sw.js` a `APP_VERSION` v `app.js` a nahraj změněné soubory na GitHub
(nahraj je kopírováním, ať ve složce zůstanou).

Místní vyzkoušení na PC: `.venv\Scripts\python.exe -m http.server 8765 --directory pwa`
a otevřít `http://localhost:8765`.
