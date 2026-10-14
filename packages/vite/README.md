# @dylanlindgren/next-ui-storybook-vite

Vite plugins that compile **ServiceNow Next Experience UI Framework** components used by the dev (Storybook) pipeline.

## Usage

```js
import { snNextUiPlugins } from '@dylanlindgren/next-ui-storybook-vite'

// Dev (e.g. from a Storybook viteFinal hook):
viteConfig.plugins.unshift(
  ...snNextUiPlugins({ mode: 'dev', componentSrcDir, projectRoot, profile }),
)
```

### `snNextUiPlugins({ mode, componentSrcDir, projectRoot, profile })`

Returns the ordered, `enforce: 'pre'` plugin set for the given mode.

| Concern | `mode: 'dev'` | `mode: 'build'` |
| --- | --- | --- |
| snabbdom JSX transform | yes | yes |
| `@servicenow/*`, `@devsnc/*` | loaded from the instance at runtime | left **external** for the platform loader |
| SCSS → string | autoprefix (+ optional rem multiplier) | + cssnano minify |
| theme-lookup dev middleware | yes | — |
| edit behaviour | full page reload | n/a |

Individual plugins (`snSnabbdomJsx`, `snInstanceModules`, `snScssAsString`, `snThemeLookup`) and helpers (`externalUrlFor`, `MEGA_PACKAGES`, constants) are also exported for advanced wiring.

Pass a resolved `connection` from `@dylanlindgren/sn-next-ui-connect` to
`snNextUiPlugins` or `snThemeLookup` to read themes directly from that instance
using the same credentials as the dev proxy. Storybook supplies this automatically.
Without a connection, standalone theme lookup retains its `now-sdk query` behavior.

## Platform export surface

`snInstanceModules` re-exports the `@servicenow/*` platform packages from the instance's `@servicenow/ui-mega` bundle. The export names are committed in `src/mega-names.generated.js`. Regenerate against an instance with:

```bash
pnpm gen:mega-names https://my-instance.service-now.com
# or set SN_MEGA_URL / SN_INSTANCE in .env or the environment
```

## Notes

- This repository is unofficial and community-maintained.

## License

[MIT](./LICENSE)
