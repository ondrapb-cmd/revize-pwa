# Revize – terénní checklist (PWA pro iPhone)

Webová aplikace, která v terénu vytvoří checklist **CL-A4-02** jako JSON. Program na PC ho
načte přes **Připojit JSON…** a zobrazí stejný kontrolní náhled jako u fotografie checklistu.
Adresa aplikace: **https://ondrapb-cmd.github.io/revize-pwa/**

- Funguje offline (service worker). Seznam objektů i rozpracované checklisty jsou jen v telefonu.
- Přes telefon se řeší jednodušší objekty; ostatní objekty odeber ze seznamu červeným **✕**.

## Novinky ve verzi 1.2.0

- **Kontrola PO po řádcích:** sekce A ukazuje řádky protokolu (Osvětlení, Průchodnost chodby, Úklid…)
  s volbou, která je teď v protokolu vybraná (tučně). Změníš jen to, co se liší, a u „závady“ napíšeš text.
  Sekce **C** (zjištěné skutečnosti) a **D** (opatření) jsou předvyplněné textem z protokolu – smaž, co
  neplatí, přidej nové řádky. Zapíše se přesně do těchto polí.
- **Hydranty:** seznam hydrantů z Přílohy 2 s minulými hodnotami („Zapsat měření“ předvyplní číslo
  a umístění) a **Závěr** – výrok (odpovídá / s omezením / neodpovídá), řádky textu a číslovaná doporučení.
- **Nouzové osvětlení:** seznam svítidel se stavem (vyhovuje / nefunkční / mimo provoz / jiný) a texty
  **Dokladu** (Zjištěné závady, Odstranění závad). „Navrhnout podle seznamu“ doplní obvyklé věty.
- **Katalog závad:** tlačítko **Katalog** u textů – výběr typové závady nebo opatření jedním klepnutím.
  Katalog se spravuje na PC (Lhůtník › Katalog závad…) a přichází s exportem.
- **OneDrive:** tlačítko **Synchronizovat** stáhne seznam z PC a odešle uložené checklisty (viz níže).
- Seznam objektů je teď v databázi telefonu (IndexedDB) – unese i velký export s podklady.

## Výměna s PC přes OneDrive (složka `OneDrive\Revize_telefon`)

- **PC → telefon:** Lhůtník › Export pro telefon uloží seznam vždy i jako `Revize_telefon\seznam.json`.
- **Telefon → PC:** checklisty patří do `Revize_telefon\checklisty`. Program na PC je hlídá: v Pracovní
  dávce svítí **Z telefonu (počet)**. Klepnutím objekt zařadí do dávky správného správce (nebo do fronty)
  a otevře kontrolu přečtených údajů. Převzaté checklisty se už nenabízí.
- Bez propojení: v telefonu **Uložit / sdílet › Uložit do Souborů › OneDrive › Revize_telefon › checklisty**.

### Propojení aplikace s OneDrive (jednou, volitelné)

Aplikace se přihlásí tvým účtem Microsoft a smí jen číst a zapisovat soubory na tvém OneDrive
(používá jen složku Revize_telefon). Potřebuje k tomu „registraci aplikace“ u Microsoftu:

1. Na PC otevři **https://entra.microsoft.com** a přihlas se účtem, ke kterému patří OneDrive.
2. **Aplikace › Registrace aplikací › Nová registrace**: název `Revize telefon`; typ účtů
   **Účty v libovolném adresáři organizace a osobní účty Microsoft**.
3. **Identifikátor URI pro přesměrování**: platforma **Jednostránková aplikace (SPA)**,
   adresa `https://ondrapb-cmd.github.io/revize-pwa/` → Zaregistrovat.
4. Zkopíruj **ID aplikace (klienta)**.
5. V telefonu: **O aplikaci, OneDrive a zálohy** › vlož ID › **Přihlásit k OneDrive** › potvrď přístup.
6. Od té doby stačí na seznamu objektů **Synchronizovat**. Přihlášení platí zhruba den; pak tě aplikace
   požádá o nové přihlášení (pár klepnutí).

---

## Postup práce

### Jednou na začátku

**PC:** složku pro výměnu s telefonem `OneDrive\Revize_telefon` založí program sám při prvním exportu.

**iPhone:**
1. Nainstaluj z App Store aplikaci **OneDrive** a přihlas se.
2. Aplikace **Soubory › Procházet › ⋯ › Upravit** → zapni **OneDrive** (jinak ho Revize při výběru souboru nevidí).
3. V Safari otevři adresu aplikace › **Sdílet › Přidat na plochu**. Dál spouštěj jen ikonou z plochy.

### Před výjezdem (PC → telefon)

1. V programu **Lhůtník** nastav období (např. měsíc), případně zaškrtni jen vybrané objekty.
2. **Export pro telefon…** → ulož do `OneDrive\PRÁCE\Lhutník\Telefon`.
   Export načte i **evidenci hasicích přístrojů** každého objektu (trvá to desítky sekund, ukazuje průběh).
3. V telefonu: **Synchronizovat**, nebo **Načíst seznam › Procházet › OneDrive › Revize_telefon › seznam.json**.
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

1. **Odeslat do OneDrive** (při propojení), jinak **Uložit / sdílet › Uložit do Souborů › OneDrive › Revize_telefon › checklisty**.
2. Když „Uložit do Souborů“ chybí: **Stáhnout** → soubor je v Soubory › Stažené, odtud ho přesuň do OneDrive.

### Zpracování na PC

1. Počkej, až OneDrive stáhne `checklist_<datum>_<adresa>.json` do `Revize_telefon\checklisty`.
2. **Pracovní dávka › Z telefonu (počet)…** › Převzít vybrané → kontrolní náhled › Potvrdit.
   (Ručně: vyber objekt › Upravit objekt › Načíst JSON….)
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
