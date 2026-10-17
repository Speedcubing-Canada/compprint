# Deploy pipeline setup

One-time GCP and GitHub configuration required before the pipeline will run.

GCP project: **scorecards-v2-prod**

---

## 1. Enable required APIs

```bash
gcloud app create --region=northamerica-northeast1 --project=scorecards-v2-prod
gcloud services enable \
  appengine.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  --project=scorecards-v2-prod
```

- `iamcredentials.googleapis.com` - required by Workload Identity Federation to mint short-lived tokens
- `cloudbuild.googleapis.com` - `gcloud app deploy` delegates builds to Cloud Build; the staging bucket (`staging.<project>.appspot.com`) is created when this API is enabled

After enabling Cloud Build, grant the App Engine default service account access to
that staging bucket (it is not granted automatically):

```bash
gcloud projects add-iam-policy-binding scorecards-v2-prod \
  --member="serviceAccount:scorecards-v2-prod@appspot.gserviceaccount.com" \
  --role="roles/storage.admin"
```

---

## 2. Create a service account

```bash
gcloud iam service-accounts create github-deploy \
  --display-name="GitHub Actions deploy" \
  --project=scorecards-v2-prod
```

Grant the App Engine deployer roles:

```bash
for ROLE in \
  roles/appengine.deployer \
  roles/appengine.serviceAdmin \
  roles/cloudbuild.builds.editor \
  roles/storage.objectAdmin; do

  gcloud projects add-iam-policy-binding scorecards-v2-prod \
    --member="serviceAccount:github-deploy@scorecards-v2-prod.iam.gserviceaccount.com" \
    --role="$ROLE"
done
```

`gcloud app deploy` delegates the actual build to Cloud Build, which runs as the
App Engine default service account. Grant `github-deploy` permission to act as it:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  scorecards-v2-prod@appspot.gserviceaccount.com \
  --member="serviceAccount:github-deploy@scorecards-v2-prod.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=scorecards-v2-prod
```

---

## 3. Configure Workload Identity Federation

```bash
# Create the pool
gcloud iam workload-identity-pools create github-pool \
  --location=global \
  --project=scorecards-v2-prod

# Create the OIDC provider
gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="attribute.repository=='Speedcubing-Canada/compprint'" \
  --project=scorecards-v2-prod

# Allow the GitHub repo to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  github-deploy@scorecards-v2-prod.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe scorecards-v2-prod --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-pool/attribute.repository/Speedcubing-Canada/compprint" \
  --project=scorecards-v2-prod
```

The `WIF_PROVIDER` value to copy into GitHub looks like:

```
projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
```

Get it with:

```bash
gcloud iam workload-identity-pools providers describe github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --project=scorecards-v2-prod \
  --format="value(name)"
```

---

## 4. Store WCA_CLIENT_SECRET in Secret Manager

The OAuth client secret must **not** go through GitHub Actions or `app.yaml`. App
Engine Standard bakes env vars from `app.yaml` into each new version at deploy
time, so any value set manually in the console is dropped on the next workflow
run. Instead, `server.js` fetches it from Secret Manager at startup.

Enable the API and create the secret (run once, then paste the secret value at
the prompt and press Ctrl-D):

```bash
gcloud services enable secretmanager.googleapis.com --project=scorecards-v2-prod

gcloud secrets create WCA_CLIENT_SECRET \
  --replication-policy=automatic \
  --project=scorecards-v2-prod

gcloud secrets versions add WCA_CLIENT_SECRET \
  --data-file=- \
  --project=scorecards-v2-prod
```

Grant the App Engine default service account read access to the secret. This is
the identity `server.js` runs as on App Engine, and it's what the Secret Manager
client picks up via Application Default Credentials:

```bash
gcloud secrets add-iam-policy-binding WCA_CLIENT_SECRET \
  --member="serviceAccount:scorecards-v2-prod@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=scorecards-v2-prod
```

To rotate the secret later, add a new version with `gcloud secrets versions add`
- the server reads the `latest` alias on startup, so the new value takes effect
on the next instance start (or after `gcloud app versions migrate`).

---

## 5. Add repository variables

**Settings → Secrets and variables → Variables → New repository variable:**

| Name | Value |
|------|-------|
| `WIF_PROVIDER` | WIF provider resource name (from step 3) |
| `WIF_SA` | `github-deploy@scorecards-v2-prod.iam.gserviceaccount.com` |
| `VITE_WCA_CLIENT_ID` | WCA OAuth client ID |

---

## 6. Usage analytics: log sink and dashboard

One-time, and independent of the deploy: without it the events still land in Cloud
Logging (queryable in Logs Explorer with `jsonPayload.component="analytics"`), they
just never reach the dashboard.

```bash
bq --location=northamerica-northeast1 mk --dataset scorecards-v2-prod:analytics

gcloud logging sinks create scorecards-analytics \
  bigquery.googleapis.com/projects/scorecards-v2-prod/datasets/analytics \
  --log-filter='resource.type="gae_app" AND jsonPayload.component="analytics"' \
  --use-partitioned-tables \
  --project=scorecards-v2-prod
```

The command prints a writer service account. Grant it write access to the dataset:

```bash
gcloud projects add-iam-policy-binding scorecards-v2-prod \
  --member="serviceAccount:<writer identity printed above>" \
  --role="roles/bigquery.dataEditor"
```

Then create the reporting view, which flattens the sink's lowercased, deeply nested
columns into usable names and builds the single `latlng` field Looker maps require:

```bash
bq --project_id=scorecards-v2-prod query --use_legacy_sql=false < docs/analytics-view.sql
```

Build the dashboard in [Looker Studio](https://lookerstudio.google.com): new report,
BigQuery connector, the `analytics.events` view (not the raw `stdout` table), plus
`analytics.generations` (generate events only) for every settings or size chart: on
`events`, sign-in rows show up as a NULL language, paper format, and so on. Set
`latlng`'s type to Geo > Latitude, Longitude by hand, Looker cannot infer it. Set the
data source's freshness to 1 hour, down from the 12 hour default, for auto-refresh.

- **Map**: Google Maps bubble chart, latitude `jsonPayload.comp.lat`, longitude
  `jsonPayload.comp.lng`, bubble size by record count. `jsonPayload.comp.country`
  drives a coarser filled-map view.
- **Charts**: events over time, competition size distribution, breakdowns by
  `settings.language` / `settings.paperFormat` / `settings.preset` /
  `scope.documents`, and `event="error"` as an error rate.

The sink is **not retroactive**: anything logged before it exists stays in Cloud
Logging only. Cloud Logging's free tier is 50 GiB/month of ingestion and BigQuery's
is 10 GiB of storage plus 1 TiB of queries, so this costs nothing at our volume.

## Custom domains

`compprint.net` is canonical (`CANONICAL_ORIGIN` in `server.js`). GET/HEAD on the earlier hosts
`scorecards.speedcubingcanada.org` and `compprint.speedcubingcanada.org` 302 to it (POSTs from tabs
opened before the move still go through); switch them to 301 once `compprint.net` has run cleanly
for a while. localStorage is per origin, so users arriving from either start with default
language, theme and analytics opt-in. `www.compprint.net` and the typo domains `comprint.*` and
`www.comprint.*` 301 to it (`TYPO_HOSTS`).

`compprint.net` is not under speedcubingcanada.org's verification: verify it in Google Search
Console with the account that owns the GCP project first. Then:

```bash
for d in compprint.net www.compprint.net; do
  gcloud app domain-mappings create $d --project=scorecards-v2-prod
done
```

At the compprint.net registrar, add the A/AAAA records gcloud prints for the apex and
`CNAME www -> ghs.googlehosted.com.`, then wait for the managed certificates
(`gcloud app domain-mappings describe ...`). The `*.speedcubingcanada.org` mappings stay. The WCA
OAuth app must list `https://compprint.net/auth/callback` as a redirect URI; keep the older ones
too. Do all of this before deploying, or sign-in breaks.
