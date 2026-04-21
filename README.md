# Synchronsprecher 🎙️

AI-gestützter Text-to-Speech Reader mit Multi-Speaker-Erkennung. Lade PDF, ePub oder TXT hoch — verschiedene Sprecher-Stimmen werden automatisch erkannt und unterschiedlichen Browser-Stimmen zugeordnet.

## Features

- 🎙️ **Multi-Speaker Mode** — Erkennt Dialog-Formate und weist verschiedene Stimmen zu
- 📄 **Datei-Upload** — PDF, ePub, TXT Unterstützung
- 📖 **Reader Mode** — Autoscroll mit aktivem Text-Chunk Highlight
- 🎧 **Mehrere Stimmen** — 20+ Browser-Stimmen konfigurierbar
- ⏸️ **Chunk-Steuerung** — Text wird in Abschnitte zerlegt, einzeln abspielbar
- 🌐 **Kein API-Key nötig** — Nutzt die Web Speech API des Browsers
- 📱 **PWA** — Installierbar, funktioniert mobil

## Tech-Stack

- **Frontend:** React 19 + TypeScript + Vite
- **TTS:** Web Speech API (Browser-nativ)
- **Parsing:** pdf.js, ePub-Parser, TXT
- **UI:** Custom mit Tailwind-ähnlichem CSS

## Lokal starten

```bash
npm install
npm run dev
npm run build
```

Brauchst **kein** API-Key — läuft komplett im Browser.

## Build-Status

`npm run build` läuft erfolgreich. Beim Bundle erscheint nur der bekannte pdf.js-`eval`-Warnhinweis.
