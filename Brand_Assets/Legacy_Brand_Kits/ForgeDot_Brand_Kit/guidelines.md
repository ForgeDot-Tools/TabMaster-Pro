# ForgeDot Tools Branding Kit

This folder contains all the official branding assets for ForgeDot Tools.

## Usage Guidelines

### 1. Vector SVGs (`/vector/`)
These are the master source files. They are styled dynamically using CSS variables to support Dark and Light modes effortlessly.

**To use in a web project:**
1. Include the provided SCSS file (`/css/_branding.scss`) in your project's stylesheet.
2. Embed the SVG code directly into your HTML. The SVG will automatically detect the user's OS preference (`prefers-color-scheme`) or your app's explicit theme (`data-theme="light"` / `data-theme="dark"`) and adapt its colors accordingly.

### 2. Raster PNGs (`/raster/`)
These are static exports for use where SVGs are not supported, such as:
- `/icon/` - Favicons (16x16, 32x32), Extension Icons (48x48, 128x128), and App Icons (512x512).
- `/primary/` - The horizontal logo (Mark + Text) for website headers or document footers.
- `/secondary/` - The stacked logo (Mark on top, Text on bottom) for social media avatars or splash screens.

Both Dark and Light variants are provided. Use the Dark variants for dark backgrounds and the Light variants for white/light backgrounds.

## Colors

- **Primary Accent (Impact Point Dot):** Electric Cyan `#00E5FF`
- **Gradient Start (Tools Text):** Purple `#6c63ff`
- **Gradient End (Tools Text):** Cyan `#00d4ff`
- **Dark Mode Text:** White `#ffffff`
- **Light Mode Text:** Dark Charcoal `#121212`
