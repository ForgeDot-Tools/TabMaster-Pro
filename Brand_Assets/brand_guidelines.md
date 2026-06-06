# ForgeDot Tools - Official Brand Guidelines

This document serves as the single source of truth for the **ForgeDot Tools** brand identity. Keep this handy when building future web apps, browser extensions, or marketing materials to ensure a consistent, premium aesthetic across your entire product ecosystem.

## 1. Brand Identity

- **Company Name:** ForgeDot Tools
- **Tagline:** *"Forging digital efficiency."*
- **Primary Aesthetic:** Premium tech software, sleek, modern, Glassmorphic UI, high-performance.

## 2. The Logo

The official ForgeDot Tools logomark is an abstract, glowing electric cyan dot centered within clean, white geometric brackets. It was designed specifically for dark backgrounds.

> [!IMPORTANT]
> **Light Theme Rule:** Because the logomark relies on white geometric lines, it will disappear on a white background. When building Light Themes in future apps, apply this CSS filter to the image to invert the white lines to black, while perfectly preserving the cyan glow:
> ```css
> .brand-logo-light {
>   filter: invert(1) hue-rotate(180deg) brightness(1.5);
> }
> ```

## 3. Typography

The official brand typeface is **Inter** (available via Google Fonts). It provides a clean, highly readable, geometric sans-serif look that fits modern tech products perfectly.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

## 4. Color Palette

The brand relies heavily on a deep, rich dark mode contrasted with vibrant, electric accents.

### Accents & Gradients
- **Primary Indigo:** `#6c63ff`
- **Electric Cyan:** `#00d4ff`
- **Brand Gradient:** `linear-gradient(135deg, #6c63ff, #00d4ff)`

### Dark Theme (Primary)
- **App Background:** `#0d1117`
- **Secondary/Sidebar Background:** `#161b22`
- **Glassmorphic Cards:** `rgba(255,255,255,0.04)` (Hover state: `0.07`)
- **Primary Text:** `#e6edf3`
- **Secondary Text:** `#8b949e`
- **Subtle Borders:** `rgba(255,255,255,0.1)`

### Light Theme
- **App Background:** `#f6f8fa`
- **Secondary/Sidebar Background:** `#ffffff`
- **Cards:** `#ffffff` (Hover state: `#f3f4f6`)
- **Primary Text:** `#1f2328`
- **Secondary Text:** `#656d76`
- **Subtle Borders:** `#d0d7de`

## 5. UI / UX Principles

When building new ForgeDot Tools products, strictly adhere to these design principles:

1. **Glassmorphism First:** Use semi-transparent card backgrounds over deep, dark app backgrounds to create a frosted glass effect. This adds depth without visual clutter.
2. **Gradient Text:** Use the brand gradient `linear-gradient(135deg, #6c63ff, #00d4ff)` with `background-clip: text; color: transparent;` to highlight key words in titles (e.g., Forge**Tabs**).
3. **Subtle Micro-animations:** Buttons and cards should have smooth transitions. Standardize on `transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);`.
4. **Rounded Corners:** Consistent use of border radii makes the app feel modern and safe. Use `6px` for small inputs, `10px` for buttons, and `14px` for large cards.

## 6. Flagship Product: ForgeTabs

**ForgeTabs** is the flagship product of ForgeDot Tools. It serves as the primary benchmark for the brand's aesthetic, tone, and user experience.

- **Product Name:** ForgeTabs - Tab Manager
- **Core Value Proposition:** Smart tab grouping, memory-saving hibernation, and seamless session management for power users.
- **Brand Voice:** Professional, efficient, empowering, and slightly technical (appealing to power users and developers) without being overly academic.
- **Key UI Paradigms to Replicate:** 
  - The Settings Dashboard layout (sidebar navigation with a wide, scrolling main content area).
  - Toggle switches that use the primary Indigo/Cyan gradient when active.
  - The "Glassmorphic" popup menu that feels lightweight but powerful.
