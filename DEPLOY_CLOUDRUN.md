# Deploying to Google Cloud Run (Optimized)

To avoid container drops, memory overloads, and frozen Puppeteer browser tabs, we have configured robust resource guidelines.

You can deploy these optimizations either **directly via the CLI** or **using the `service.yaml` configuration**.

---

## Option 1: Direct Deployment CLI Command (Recommended)

Run the following unified `gcloud run deploy` command in your terminal to apply all of the optimizations instantly:

```bash
gcloud run deploy co-browsing-app \
  --image=gcr.io/YOUR_PROJECT_ID/co-browsing-app:latest \
  --platform=managed \
  --region=us-central1 \
  --allow-unauthenticated \
  --port=3000 \
  --cpu=2 \
  --memory=4Gi \
  --no-cpu-throttling \
  --timeout=3600 \
  --concurrency=15
```

### Explanations of CLI Options:
* `--cpu=2` and `--memory=4Gi`: Allocates high-capacity virtual hardware to ensure the headless Chromium browser has plenty of memory space and thread throughput.
* `--no-cpu-throttling`: **Crucial.** Sets CPU allocation strategy to *"CPU is always allocated"*. This stops Google from pausing the container and freezing Puppeteer's active streaming/Websocket loops when no client HTTP requests are coming in.
* `--timeout=3600`: Sets the max lifetime of streaming socket connection requests to **1 hour (3600 seconds)**, preventing watch parties from abruptly timing out.
* `--concurrency=15`: Limits concurrent connections per container to **15**, triggering the Google Cloud Run autoscaler to boot a brand new container horizontally before memory on any individual container gets exhausted.

---

## Option 2: Using the `service.yaml` Configuration

If you prefer configuration-as-code, a preconfigured `service.yaml` has been generated for you in the root folder.

### 1. Update the Placeholder
Open `service.yaml` and replace `YOUR_PROJECT_ID` with your actual Google Cloud Project ID.

### 2. Run the Deployment Command
Apply the configuration file directly using:

```bash
gcloud beta run services replace service.yaml
```
