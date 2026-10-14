// PostCSS plugin that rewrites every `rem` length into
// `calc(<n>rem * var(<multiplierCssVarName>))` so a runtime CSS variable can
// scale all rem-based sizing (e.g. for density/zoom adjustments).
const REM_RE = /"[^"]+"|'[^']+'|url\([^)]+\)|(-*\d*\.?\d+)rem/g

export default function remMultiplier(multiplierCssVarName) {
  return {
    postcssPlugin: 'sn-rem-to-rem-multiplier',
    Once(root) {
      if (!multiplierCssVarName) return
      root.walkDecls((decl) => {
        if (decl.value.indexOf('rem') === -1) return
        decl.value = decl.value.replace(REM_RE, (match, value) =>
          value
            ? `calc(${parseFloat(value)}rem * var(${multiplierCssVarName}))`
            : match,
        )
      })
    },
  }
}
remMultiplier.postcss = true
