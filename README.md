# UCLLibraryTracker

See how full each UCL library is, at a glance, on a map.

> ⚠️ Student project — **not** an official UCL service.

## What it does

- Shows every UCL library on a map, each marked by how busy it is right now:
  - ○ **Green** — plenty of space (under 60% full)
  - 🟠 **Amber** — filling up (60–85% full)
  - ● **Red** — very busy (over 85% full)
- Click a library to see how many desks are free, get **directions** to it, and
  view a **busyness graph** showing how full it gets through the day.

## How to access it

\```bash
npm install
npm start
\```

Then open **http://localhost:3000** in your browser.

It runs straight away with demo data so you can try it immediately. To show
real live occupancy instead, copy `.env.example` to `.env` and follow the notes
inside it.

## License

MIT

