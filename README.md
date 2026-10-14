# next-ui-storybook

An unofficial toolkit for developing ServiceNow Next Experience UI Framework
components with Vite and Storybook.

## Workspace packages

| Package | Purpose |
| --- | --- |
| `@dylanlindgren/next-ui-storybook-vite` | Vite plugins for compiling component JSX and styles, resolving instance modules, and looking up themes. |
| `@dylanlindgren/next-ui-storybook-connect` | ServiceNow connection and authenticated development-proxy utilities. |
| `@dylanlindgren/next-ui-storybook-addon` | Storybook preset and addon that wires the Vite plugins, instance proxy, and theme lookup together. |
| `@dylanlindgren/next-ui-storybook-example-cli` | Example component project with stories used to exercise the workspace packages. |

## Prerequisites

- Node.js 22 or newer
- pnpm
- A ServiceNow instance for full component previews. Configure either
  `SN_INSTANCE`, `SN_USER`, and `SN_PASS`, or an `snc` profile on macOS.

## Contributing

Install dependencies from the workspace root:

```sh
pnpm install
```

Start the example Storybook:

```sh
pnpm dev
```

Create a static Storybook build for the example:

```sh
pnpm build-storybook
```

Run the package tests:

```sh
pnpm test
```

The example project is in [`examples/cli`](./examples/cli). Its
[README](./examples/cli/README.md) describes the sample components and stories.

## Developing components

The example project demonstrates the Storybook workflow. Add component source
and stories under `examples/cli`, then use `pnpm dev` to preview them locally.
The Vite package also exports plugins for use in other projects; see
[`packages/vite/README.md`](./packages/vite/README.md) for its API.

This workspace currently provides local development tooling and an example
project; deployable artifact generation, SDK scaffolding, and deployment are
not included.

## License

[MIT](./LICENSE)
