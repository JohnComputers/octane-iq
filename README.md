# Octane IQ

[Play the website](https://johncomputers.github.io/octane-iq/) · [Photo game](https://johncomputers.github.io/octane-iq/spotter.html)

Free automotive trivia and car identification with no ads, paid tiers, or external image hotlinks. An account is optional. Games run entirely in the browser; accounts use Supabase Auth.

## Games

- **Daily Drive:** seven balanced questions shared each UTC day, with a seven-day repeat exclusion window.
- **Quick Lap:** five random practice questions.
- **Time Attack:** 90 seconds, with difficulty-weighted points.
- **Endurance:** medium and hard questions until three misses; the question queue replenishes.
- **Category Garage:** focused ten-question rounds across eight subjects.
- **Spotter:** identify real cars from progressively wider photo crops. Includes a daily challenge and unlimited practice.
- **Cardle / Supercardle / Eurocardle:** searchable make/model dropdowns and a numeric year, independent feedback per field, five reveals, and ±2-year tolerance. Includes separate Daily and Practice modes for all three pools.
- **CarConnections:** group sixteen terms into four automotive categories. Twelve curated boards, Daily and unlimited Practice, with explanations after each group.
- **AutoAsk:** twenty-turn car deduction from an inspectable yes/no fact bank. Includes searchable questions, guesses, Daily and Practice, and a full-photo reveal.

The bank has 96 trivia questions. Every answer has an explanation and a source. The photo library contains 80 cars, including 34 supercars and 52 European cars. Photos are included in `dist/assets/cars/`; individual photographers, original sources, and licenses are listed in `dist/data/cars.json` and on the [credits page](https://johncomputers.github.io/octane-iq/credits.html).

The searchable vehicle catalogue contains 195 passenger-car makes and 2,831 make/model pairs from [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/), supplemented at runtime by photographed classic cars. This is not an exhaustive world/history/model-year database. Photo game years come from source-documented model years; the catalogue does not invent availability years.

Daily photo assignments are pinned in `dist/data/daily-cars.json`. After expanding the library, run `node scripts/update-daily-cars.mjs YYYY-MM-DD` using today's UTC date to refresh the coming year while preserving today's assignments and saved games.

Optional Google and email accounts use Supabase Auth. The code includes REST/PKCE integration, but accounts stay explicitly disabled until a project URL and public publishable key are configured. See [authentication setup](docs/AUTH_SETUP.md). All games remain available to guests. Authentication does not currently sync game statistics across devices.

## Local development

Requires Node.js 22 or newer. The app itself has no runtime dependencies.

```powershell
npm ci
npm test
npm run serve
```

Open `http://127.0.0.1:4173/`. On Windows, `Start Octane IQ.cmd` also starts the preview server.

To preview the GitHub Pages project path:

```powershell
$env:BASE_PATH = 'octane-iq'
npm run serve
```

Then open `http://127.0.0.1:4173/octane-iq/`.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` validates the app and deploys `dist/` on every push to `main`. Repository Settings → Pages must use **GitHub Actions** as its build source. No secrets or paid services are needed.

All site resources use relative URLs. The same files work at a domain root or at `/octane-iq/`. The service worker uses its own directory scope and refreshes app and data files from the network while retaining an offline copy.

## Privacy and content

Progress, themes, and streaks are stored only in the visitor's browser. Downloads contain local trivia data. There is no analytics or global leaderboard. Resetting browser storage removes progress.

The question bank is versioned in `dist/app.js`. When revising existing questions, bump `BANK_VERSION` and the service-worker cache version. Preserve photo license attribution when adding or changing images.

Automated checks cover content shape, deterministic daily selection, gameplay, resuming, keyboard behavior, project-path asset resolution, and photo decoding. Real browser layout testing remains a separate check.
