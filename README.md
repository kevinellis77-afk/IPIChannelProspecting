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
