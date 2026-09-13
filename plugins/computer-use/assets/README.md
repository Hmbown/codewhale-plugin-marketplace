# Computer Use identity

The existing Codewhale whale contour is retained, with a small pointer in the
upper-right negative space. Navy and white remain the main app colors;
cyan distinguishes the Computer Use pointer.

- `icon-light.svg`, `icon-dark.svg`: canonical vector tile variants.
- `icon-mono.svg`: transparent single-color mark; inherits `currentColor`.
- `icon-{light,dark}-{32,64,256}.png`: small/catalog artwork.
- `icon-menubar.png`: 36px template rendered at 18pt by macOS.
- `icon-source.png`: 1024px master for the existing ICNS/ICO/Linux pipeline.

Run `npm run build:branding` to render the vectors and regenerate platform
icons. Sharp is a build-time dependency only. The original vector contour is
from Codewhale's `web/app/icon.svg`; these are code-authored brand assets, not
screenshots or generated product evidence. Keep the tile at its native aspect
ratio and give monochrome icons the surrounding text's foreground color.
