# Pull Request Filtered List

An Azure DevOps dashboard widget that displays a configurable, filtered list of pull requests.
Each widget tile on a dashboard can be independently configured with its own filter settings.
Available in Azure Devops marketplace: https://marketplace.visualstudio.com/items?itemName=ommhoa.pull-requests-filtered

## Features

- **Cross-project** — scope a tile to any subset of projects in the organisation, or leave blank for all projects
- Filter by **PR status** (Active, Draft, Approved, Abandoned, Completed, …)
- **Linked work item type filter** — enter a type name (e.g. "Task") to filter by link: optionally show only PRs **not** linked to that type, or only PRs that **are** linked; leave blank to skip this filter
- Configurable **max count** (1–50 items per tile)
- Multiple resizable tile sizes: 2×2, 2×3, 3×2, 3×3
- Each tile is independently configured via Azure DevOps' built-in configuration panel

## Project Structure

```
scripts/              TypeScript + React source
  Widget.tsx          Widget tile (IConfigurableWidget)
  WidgetConfig.tsx    Configuration panel (IWidgetConfiguration)
  Querying.ts         Azure DevOps REST layer
  Filtering.tsx       Filter logic & query criteria builder
  widget.html         Widget tile page
  widget-config.html  Configuration panel page
img/                  Extension icons
configs/
  dev.json            Dev build overrides (private, id suffix -dev)
  release.json        Release build overrides (public)
vss-extension.json    Extension manifest
webpack.config.js     Build configuration
CODEBASE.md           Detailed developer guide
```

## Getting Started

1. Clone the repository
2. `npm install`
3. `npm run build:dev` — builds the extension and produces a `.vsix` file
4. Upload `ommhoa.pull-requests-filtered-dev-*.vsix` to the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage)
5. Share the extension with your Azure DevOps organization
6. Install it from **Organization Settings → Extensions**
7. Add the **Pull Request Filtered List** widget to any dashboard via **Edit → Add a widget**

## npm scripts

| Script | What it does |
|---|---|
| `npm run build` | Production webpack compile → `dist/` + package both `.vsix` files |
| `npm run build:dev` | Development compile + package both `.vsix` files |
| `npm run debug` | Webpack dev server at `https://localhost:3000` |
| `npm run clean` | Delete `dist/` |

## Version History

See [details.md](details.md) for the full Marketplace listing description.

## Credits

Inspired by https://github.com/yang-er/Pull-Request-Search
