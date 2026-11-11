# UCLLibraryTracker

See how full each UCL library is, at a glance, on a map.

> ⚠️ Student project — **not** an official UCL service.

## What it does

- Shows every UCL library on a map, each marked by how busy it is right now:
  - 🟢 **Green** — plenty of space (under 60% full)
  - 🟠 **Amber** — filling up (60–85% full)
  - 🔴 **Red** — very busy (over 85% full)
- Find libraries **near you** — it can use your location to centre the map and
  sort libraries nearest-first.
- Click a library to see how many desks are free, get **directions** to it, and
  view a **busyness graph** showing how full it gets through the day.

## How to access it

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

It runs straight away with **demo data** so you can try it immediately — the
busyness graph is pre-populated so there's something to see. To show real live
occupancy instead, copy `.env.example` to `.env` and follow the notes inside it.

## Put it online (shareable link)

The repo includes a `render.yaml`, so you can deploy a public demo for free on
[Render](https://render.com): sign in with GitHub, choose **New → Blueprint**,
and pick this repo. Render builds it and gives you a public URL.

> The free tier runs on demo data and sleeps when idle (first visit after a nap
> takes ~30–60s to wake). The demo busyness graph is regenerated on each boot.

## License

MIT
