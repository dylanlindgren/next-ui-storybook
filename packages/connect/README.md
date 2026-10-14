# @dylanlindgren/sn-next-ui-connect

Shared ServiceNow connection and authenticated Vite proxy utilities.

## Credentials

By default, credentials are sourced the same way as `next-ui-mcp`'s `snc`
profile fallback:

- Read the instance host and username from `~/.snc/config.json`, under
  `profiles[profile]`.
- Read the password from the macOS Keychain: service `snc`, account equal to
  the profile name, with a JSON value containing a `password` string.
- Select the explicit `profile` option, then `SN_PROFILE`, then `default`.
  Only basic-auth profiles are supported.

Configure profiles with the ServiceNow CLI's `snc configure profile` command.
The former `ServiceNow` / `now-sdk` Keychain store is no longer read.

To override profile credentials, set **all three** of `SN_INSTANCE`, `SN_USER`
and `SN_PASS`. These take precedence and work on non-macOS platforms too.
Partial environment credentials produce a connection error rather than silently
falling back to a different instance. Bare hostnames are normalized to HTTPS,
and trailing slashes are removed. Instance URLs must be HTTP(S) origins without
embedded credentials, paths, queries or fragments.

Storybook also loads these variables from the project's Vite `.env` files.
Its instance proxy and theme discovery share the same resolved credentials.
Standalone Vite callers that do not supply a connection to `snThemeLookup`
retain its `now-sdk query` behavior.

## API

```js
import { resolveSncConnection, buildProxy } from '@dylanlindgren/sn-next-ui-connect'

const conn = resolveSncConnection() // process.env, then snc profile "default"
const { proxy, status } = buildProxy({ conn, projectRoot: process.cwd() })
```

`resolveSncConnection({ profile, env })` returns either a usable descriptor
(`ok`, `source`, `profile`, `loginmethod`, `target`, `user`, `pass`) or
`{ ok: false, source, profile, reason }`. Environment connections do not have a
profile. Credential/config errors are reported without exposing password values.

`buildProxy` returns authenticated HTTP and AMB websocket proxy entries.
On failure, it logs the reason and disables the proxy. Its `status` is a
password-free summary suitable for the Storybook panel; never expose the full
connection descriptor or proxy headers to the browser.

`KEYCHAIN_SERVICE` is `snc`. `KEYCHAIN_ACCOUNT` is the default account (`default`);
named profiles use their alias instead. `DEFAULT_SNC_PROFILE` is also exported.

## Tests

```bash
pnpm --filter @dylanlindgren/sn-next-ui-connect test
```

Tests use simulated configuration and Keychain readers, not real credentials.
