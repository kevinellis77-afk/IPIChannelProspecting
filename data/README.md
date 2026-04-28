# Dataset files

This app attempts to load prospect data from `data/ukchannel.json` first.
If that request fails, it falls back to the inline compressed backup (`DATA_B64`) embedded in `index.html`.

## Expected filename and format

- **Primary filename:** `data/ukchannel.json`
- **Format:** UTF-8 encoded JSON file containing an array of company objects.
- **Representative object shape:**

```json
{
  "id": 1001,
  "name": "Example Channel Ltd",
  "domain": "examplechannel.co.uk",
  "city": "London",
  "county": "Greater London",
  "country": "ENGLAND",
  "industry": "IT Services",
  "channel_role": "Reseller",
  "channel_segment": "SMB",
  "employees": "11-50",
  "revenue": 4200,
  "credit_score": 78,
  "credit_description": "Good Creditworthiness",
  "adopter_profile": "Early adopter",
  "var_type": "VAR",
  "tech_stack": ["Microsoft 365", "UCaaS"],
  "partners": ["MICROSOFT", "GAMMA"],
  "keywords": "managed services, voice",
  "dir1_first": "Alex",
  "dir1_last": "Morgan"
}
```

### Calibration sample file

- **Calibration filename:** `data/calibration_set.json`
- **Purpose:** Fixed curated sample to validate scoring/ranking behavior after threshold tuning.
- **Structure:**
  - `records` (array of sample companies)
  - `expected_order` (array of record ids in expected strongest-to-weakest order)
  - `validation_groups` (grouped ids for targeted checks)

### Required fields for safe filtering

At minimum, each record should include:

- `id` (unique number)
- `name`, `domain`, `city`, `county`, `country` (strings)
- `industry`, `channel_role`, `channel_segment`, `employees` (strings)
- `tech_stack` (array of strings)
- `partners` (array of strings)
- `keywords` (string)

Other fields are optional but recommended (`revenue`, `credit_score`, `credit_description`, `adopter_profile`, `var_type`, director fields, etc.) for richer sorting/details/export output.

## Refresh/export workflow

1. Prepare the latest source dataset outside the app (CSV/DB/query output).
2. Transform it into the JSON shape above.
3. Write/replace `data/ukchannel.json`.
4. Sanity-check that JSON parses (for example: `jq length data/ukchannel.json`).
5. Open the app and verify it loads without showing the fallback banner.
6. Use in-app **Export CSV** / **HubSpot CSV** buttons to export filtered records for downstream tools.

## Serving in local + GitHub Pages deployments

The file must be available at a **relative path** from `index.html`:

- Local static server: `http://localhost:<port>/data/ukchannel.json`
- GitHub Pages project site: `https://<org>.github.io/<repo>/data/ukchannel.json`

Because `index.html` fetches `data/ukchannel.json` as a relative URL, avoid absolute URLs and ensure the `data/` folder is committed to the repository.

## Manual calibration workflow

Use this process whenever tuning model/heuristic weights:

1. Run a fresh ranking and export/snapshot results.
2. Review the **top 20** and **bottom 20** ranked accounts for obvious false positives/negatives.
3. Cross-check those results with the curated samples in `data/calibration_set.json`.
4. Adjust threshold cutoffs (keep dimension weights unchanged unless business owners explicitly request a weight change).
5. Re-run ranking and verify expected calibration outputs.
6. Re-validate reason-code explainability with channel sales stakeholders.

For repeatable validation and evidence capture, run:

```bash
node scripts/calibration_audit.js
```

This updates `data/top20_before_after.md` with a before/after top-20 ranking comparison.
