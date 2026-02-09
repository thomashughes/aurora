# Aurora — Space Weather Sonified

An immersive 3D audio-visual experience that transforms real NOAA space weather data into a living aurora. Built with Three.js, Tone.js, and custom GLSL shaders.

## What it does

Fetches 7 days of real space weather measurements from NOAA's deep-space satellites (DSCOVR & GOES) and replays them as light and sound:

- **40,000 shader particles** form aurora curtains that shift from green (quiet) to red/purple (storm)
- **6-voice Tone.js engine** generates ambient audio driven by solar wind speed, magnetic field, plasma density, and more
- **Post-processed bloom** with particle trails via ping-pong render targets
- **Interactive timeline scrubber** — click to jump to any point in the past week
- **5 camera presets** — Orbital, ISS, Ground, Polar, Cinematic

Falls back to realistic simulated data if NOAA endpoints are unavailable.

## Tech stack

Three.js · GLSL Shaders · Tone.js · NOAA SWPC API · WebGL · React · Vite

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output goes to `dist/` — static files, deploy anywhere.

## Author

[TAGart](https://portfolio.tag-art.co.uk) — Thomas Hughes
