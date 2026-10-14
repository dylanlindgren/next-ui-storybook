import React from 'react'
import { addons, types, useChannel, useGlobals } from 'storybook/manager-api'
import { AddonPanel, Badge, Form, IconButton, WithTooltip, TooltipLinkList } from 'storybook/internal/components'
import { styled } from 'storybook/theming'
import { PaintBrushIcon } from '@storybook/icons'

import {
  ADDON_ID,
  PANEL_ID,
  TOOL_ID,
  THEME_GLOBAL,
  EVENT_STATUS,
  EVENT_REQUEST_STATUS,
} from './src/constants.js'

const h = React.createElement

// Use Storybook's theme tokens so the panel inherits the active manager theme
// (light/dark, fonts, colors) instead of hardcoding its own CSS.
const Wrapper = styled.div(({ theme }) => ({
  padding: 15,
  fontSize: theme.typography.size.s2,
  lineHeight: '18px',
  color: theme.color.defaultText,
}))

const Section = styled.div({ marginBottom: 20 })

const Heading = styled.h3(({ theme }) => ({
  margin: '0 0 10px',
  fontSize: theme.typography.size.s1,
  fontWeight: theme.typography.weight.bold,
  letterSpacing: 0.35,
  textTransform: 'uppercase',
  color: theme.color.mediumdark,
}))

const RowEl = styled.div({ display: 'flex', gap: 8, padding: '2px 0' })

const Key = styled.span(({ theme }) => ({ flex: '0 0 110px', color: theme.color.mediumdark }))

const Val = styled.span(({ theme }) => ({ fontFamily: theme.typography.fonts.mono, wordBreak: 'break-all' }))

const StatusBar = styled.div({ marginBottom: 8 })

const Message = styled.div(({ theme }) => ({
  color: theme.color.warningText,
  background: theme.background.warning,
  padding: 8,
  borderRadius: theme.appBorderRadius,
}))

const Hint = styled.div(({ theme }) => ({ color: theme.color.mediumdark, marginBottom: 8 }))

const Row = (k, v) => h(RowEl, { key: k }, h(Key, null, k), h(Val, null, v))

function Panel() {
  const [data, setData] = React.useState({ status: {}, themes: [] })
  const [globals, updateGlobals] = useGlobals()

  const emit = useChannel({
    [EVENT_STATUS]: (payload) => setData(payload || { status: {}, themes: [] }),
  })

  React.useEffect(() => {
    emit(EVENT_REQUEST_STATUS)
  }, [emit])

  const { status = {}, themes = [], themesError } = data
  const active = globals[THEME_GLOBAL]

  const sourceLabel = {
    sdk: 'ServiceNow SDK profile',
    snc: 'ServiceNow CLI (snc) profile',
    env: 'SN_* environment variables',
    none: 'not configured',
  }[status.source] || status.source || 'unknown'

  return h(
    Wrapper,
    null,
    h(
      Section,
      null,
      h(Heading, null, 'Instance connection'),
      h(
        StatusBar,
        null,
        status.proxyEnabled
          ? h(Badge, { status: 'positive' }, 'Proxy enabled')
          : h(Badge, { status: 'warning' }, 'Proxy disabled'),
      ),
      !status.proxyEnabled && status.reason ? h(Hint, null, status.reason) : null,
      Row('Source', sourceLabel),
      status.profile ? Row('Profile', status.profile) : null,
      status.target ? Row('Instance', status.target) : null,
      status.user ? Row('Username', status.user) : null,
      status.loginmethod ? Row('Login', status.loginmethod) : null,
      status.prefixes?.length ? Row('Proxied', status.prefixes.join(', ')) : null,
    ),
    h(
      Section,
      null,
      h(Heading, null, 'Theme'),
      !status.proxyEnabled
        ? h(Hint, null, 'Connect to an instance to discover themes.')
        : null,
      themesError ? h(Message, null, themesError) : null,
      themes.length
        ? h(
            Form.Select,
            {
              value: active ?? '',
              onChange: (e) => updateGlobals({ [THEME_GLOBAL]: e.target.value }),
            },
            themes.map((t) =>
              h('option', { key: t.themeId || t.name, value: t.name }, t.name),
            ),
          )
        : h(Hint, null, 'No themes configured.'),
    ),
  )
}

// Toolbar dropdown to switch the active theme. Lives in the manager (not a
// static preview globalTypes toolbar) so its items can be the themes the preview
// live-discovers on boot and broadcasts via EVENT_STATUS.
function ThemeTool() {
  const [themes, setThemes] = React.useState([])
  const [globals, updateGlobals] = useGlobals()

  const emit = useChannel({
    [EVENT_STATUS]: (payload) => setThemes(payload?.themes ?? []),
  })

  React.useEffect(() => {
    emit(EVENT_REQUEST_STATUS)
  }, [emit])

  const active = globals[THEME_GLOBAL]
  if (!themes.length) return null

  return h(
    WithTooltip,
    {
      placement: 'top',
      trigger: 'click',
      closeOnOutsideClick: true,
      tooltip: ({ onHide }) =>
        h(TooltipLinkList, {
          links: themes.map((t) => ({
            id: t.themeId || t.name,
            title: t.name,
            active: t.name === active,
            onClick: () => {
              updateGlobals({ [THEME_GLOBAL]: t.name })
              onHide()
            },
          })),
        }),
    },
    h(
      IconButton,
      { title: 'ServiceNow instance theme' },
      h(PaintBrushIcon),
      h('span', { style: { marginLeft: 6 } }, active || 'SN Theme'),
    ),
  )
}

addons.register(ADDON_ID, () => {
  addons.add(TOOL_ID, {
    type: types.TOOL,
    title: 'ServiceNow theme',
    match: ({ viewMode }) => viewMode === 'story',
    render: () => h(ThemeTool),
  })
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'ServiceNow',
    match: ({ viewMode }) => viewMode === 'story',
    render: ({ active }) => h(AddonPanel, { active }, h(Panel)),
  })
})
