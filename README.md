# Paddock

Paddock is an unofficial Star Wars: Galactic Racer companion for planning builds, reading standard multiplayer guides, and recording tours. It uses editorial synergy recommendations grounded in the sources linked in the app.

[Open Paddock](https://tylersahagun.github.io/paddock-galactic-racer/)

Build plans and tour history are saved in the browser's IndexedDB. Use the in-app backup controls to move records between browsers or import an export from the Mac app. The hosted site uses manual tour entry. The watchlist and offer comparisons use the original Python rules in a browser worker.

## Tour results

Scroll to **Tour results** at the bottom of **Build**, or use the **Results** shortcut. Start or select a tour there to record all 12 drivers across five stages and a separate final race. Choose your row and the stage you joined. The standings are included in tour backups.

## Preview

From the repository root, run `python3 -m http.server 8000`. Visit `http://localhost:8000/docs/` in a current browser. GitHub Pages serves `docs/` from the publishing branch.

## Runtime assets

- The bundled Pyodide 0.29.4 files are from the [Pyodide npm release](https://www.npmjs.com/package/pyodide/v/0.29.4). The upstream [source and build instructions](https://github.com/pyodide/pyodide/tree/0.29.4) and the included MPL 2.0 license cover the runtime. The bundled `pydecimal` wheel is from the same release, checked against `pyodide-lock.json`.
- The Python standard library comes from [CPython 3.13.2](https://github.com/python/cpython/tree/v3.13.2). Its license is in `docs/vendor/pyodide/`.
- Unbounded and Barlow Condensed are bundled with their SIL Open Font Licenses in `docs/assets/fonts/`.
