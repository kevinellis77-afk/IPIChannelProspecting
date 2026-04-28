# IPIChannelProspecting
Search tool for IPI Channel prospects.

## Data refresh workflow

The app loads an external JSON dataset from `data/ukchannel.json` first, and only falls back to the inline backup blob in `index.html` if that file is unavailable.

### Expected dataset filename/format

- Primary dataset path: `data/ukchannel.json`
- File type: UTF-8 JSON
- Top-level structure: array of company records
- Minimum safe fields per record:
  - `id` (unique number)
  - `name`, `domain`, `city`, `county`, `country`
  - `industry`, `channel_role`, `channel_segment`, `employees`
  - `tech_stack` (array), `partners` (array), `keywords`
- Recommended additional fields:
  - `revenue`, `credit_score`, `credit_description`, `adopter_profile`, `var_type`, director fields

See `data/README.md` for a representative object and extra implementation notes.

### Calibration set for score tuning

A fixed calibration sample is available at `data/calibration_set.json` for score quality checks.
The file now includes:

- `records`: fixed synthetic sample records used for repeated calibration validation
- `expected_order`: expected strongest-to-weakest ordering of those records
- `validation_groups`: scenario groups used to test specific ranking behaviors

Use this sample as a stable benchmark when tuning threshold behavior.

### How to refresh/export data

1. Produce your latest source extract from your upstream system.
2. Transform/mapping step: convert source fields into the app JSON schema.
3. Replace `data/ukchannel.json` with the new JSON output.
4. Validate file integrity (example):
   - `jq length data/ukchannel.json`
5. Run the app and ensure it loads without the fallback warning banner.
6. Use in-app export buttons to generate CSVs from the full or filtered set.

### Local + GitHub Pages serving behavior

The fetch path is relative (`data/ukchannel.json`), so both deployment modes should serve:

- Local static hosting: `http://localhost:<port>/data/ukchannel.json`
- GitHub Pages project hosting: `https://<org>.github.io/<repo>/data/ukchannel.json`

As long as the `data/` directory is committed at repo root, the same relative path works in both environments.

## Manual calibration workflow

When refining ranking quality, use this lightweight process:

1. Generate the latest ranked account list from the app.
2. Review the **top 20** and **bottom 20** ranked accounts against business expectations.
3. Compare outcomes for calibration accounts in `data/calibration_set.json`.
4. Adjust score thresholds/cutoffs only (do **not** change dimension weights unless explicitly requested by business owners).
5. Re-run ranking and validate improvements against the same top/bottom slices.
6. Re-validate reason-code explainability with channel sales stakeholders before finalizing changes.

The automated calibration audit script (`node scripts/calibration_audit.js`) also writes a before/after top-20 comparison to `data/top20_before_after.md`.
