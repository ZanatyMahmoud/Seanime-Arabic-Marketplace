# Shared Extractors

The reusable extractor implementation is currently consolidated in `../runtime.ts` so the dependency-free build can concatenate one shared runtime plus one provider into a single Seanime TypeScript payload. Functions include VidYard, OK.ru, MP4Upload, SoraPlay/YonaPlay, HLS master-playlist expansion, direct `<source>` extraction and generic exposed-media fallback.

If individual extractor files are introduced later, `scripts/build.js` must bundle them into the single payload because Seanime loads the manifest `payloadURI` as one runtime script.
