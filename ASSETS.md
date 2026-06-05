# Assets Guide

This template keeps asset filenames stable so you can replace images without changing code.

## Renderer Pet Assets

Main pet assets are loaded by Vite import from:

```text
src/renderer/src/assets/
```

Required files:

```text
idle.png
hover.png
click.png
unread.png
drag_right.gif
```

Recommended format:

- Transparent PNG for `idle`, `hover`, `click`, `unread`.
- Transparent GIF or neutral placeholder GIF for `drag_right`.
- Keep all pet images on the same canvas size.
- Recommended canvas: square `512 x 512` or a consistent transparent canvas with enough padding.
- Keep the character visually centered and similarly sized across states.

Current drag implementation uses only `drag_right.gif`.

- Dragging right: normal `drag_right.gif`.
- Dragging left: CSS `scaleX(-1)` mirror of `drag_right.gif`.

Do not add `drag_left.gif` unless you also update the renderer logic.

## Icon Assets

Windows packaging uses:

```text
build/icon.ico
build/icon.png
resources/icon.png
```

Recommended icon sizes:

- 16 x 16
- 32 x 32
- 48 x 48
- 64 x 64
- 128 x 128
- 256 x 256

Use a simple head or upper-body crop. Full-body icons are usually too small to read.

## Public Assets

`public/assets/` is kept for simple development fallback examples. The packaged desktop pet uses imported assets from `src/renderer/src/assets/`, so replacing only `public/assets` will not update the packaged desktop pet.

After replacing assets, run:

```text
npm.cmd run build
npm.cmd run build:win
```
