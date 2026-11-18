# Cartafella Analytics – Finance Dashboard (web)

The Finance Database & Profitability Dashboard workbook (v1.2) as a website, with
every tab in the same order and layout as the Excel file.

- **Same numbers as Excel.** The page recalculates the workbook's own formulas in the
  browser. It was checked against a full recalculation of the workbook: all 87,004
  formula cells match.
- **Login.** Email and password through Supabase. New accounts wait for an admin to
  approve them.
- **Roles.** *viewer* (read only), *editor* (can enter data), *admin* (can also manage users).
- **Data entry like Excel.** Only the yellow input cells can be edited. Drop-down lists,
  date and number checks, copy/paste from Excel, Delete to clear, Ctrl+Z to undo.
- **Change tracking.** Every change is saved with who, when, tab, cell, old value and new
  value. Use **Change history** (filters and CSV download), or select a cell to see who
  changed it last.
- **Live.** Changes made by one person appear for others within seconds.
- **Excel in and out.** *Import Excel* loads the input cells from a workbook with the same
  layout (for example the original v1.2 file). *Download Excel* saves all tabs, with
  formatting, as values.
- **Personal selectors.** Year, period and vertical choices on the report tabs are kept
  per user in the browser. They are not shared and not recorded as changes.

## Setup

### 1. Supabase
1. Create a project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste `supabase/schema.sql` and click **Run**.
3. Under **Authentication → Sign In / Providers → Email**, keep email sign-in on.
   Under **Authentication → URL Configuration**, set **Site URL** to the address of
   the published site, so confirmation and password-reset emails link back to it.
4. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.

### 2. Site settings
Put the two values into `js/config.js`:

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJ...',
```

The anon key is meant to be public. Data access is controlled by the login and by
the database rules in `supabase/schema.sql`. Never put the `service_role` key in this site.

While `js/config.js` is empty, the site runs in **demo mode**: no login, and data stays
in that browser only.

### 3. Publish (GitHub Pages)
Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*,
branch `main`, folder `/ (root)`. The site appears at
`https://<user>.github.io/<repository>/`.

### 4. First use
1. Open the site and **Create an account**. The first account becomes **admin**.
2. Click **Import Excel** and choose the v1.2 workbook to load its data, or start empty.
3. When ready to go live, use **Remove example data** (user guide, section 17).
4. Colleagues create their accounts, then the admin sets their role under **Users**.

## Changing the workbook design
The site layout comes from `data/model.json`, which is generated from the Excel file.
If the workbook's layout or formulas change (a new version), regenerate it:

```bash
pip install openpyxl
python3 tools/build_model.py "Cartafella-Analytics-Finance-Dashboard-vX.xlsx" data
```

Data is stored by tab name and cell address (for example `Ledger!N12`). Keep the input
cells in the same places, or move the stored data along with them.

## Files
| Path | Purpose |
|---|---|
| `index.html`, `css/app.css` | Page and styling |
| `js/engine.js` | Formula engine (the Excel functions this workbook uses) |
| `js/fmt.js` | Excel number formats |
| `js/grid.js` | Tab display, colour rules, charts, editing, drop-downs, paste |
| `js/app.js` | Login, saving, history, users, import/export |
| `js/backend.js` | Supabase connection (plus demo mode) |
| `js/config.js` | Supabase URL and anon key |
| `data/model.json` | Workbook layout and formulas (no data) |
| `supabase/schema.sql` | Database tables, roles, security rules, save function |
| `tools/build_model.py` | Rebuilds `data/model.json` from the Excel file |
| `vendor/`, `fonts/` | Chart.js, ExcelJS, Supabase JS, Poppins (see `vendor/LICENSES.txt`) |

## Limits
- Tables have the same pre-set size as the workbook (for example 1,500 Ledger lines).
- Formulas and layout come from the workbook and are not edited on the site.
- The Excel download contains values and formatting, not formulas or charts.
