package uiservice

import (
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

// venzoTheme keeps the native Fyne platform theme while applying the Venzo
// red accent consistently to buttons, focus rings and selected controls.
type venzoTheme struct {
	base fyne.Theme
}

func newVenzoTheme(base fyne.Theme) fyne.Theme {
	return &venzoTheme{base: base}
}

func (t *venzoTheme) Color(name fyne.ThemeColorName, variant fyne.ThemeVariant) color.Color {
	switch name {
	case theme.ColorNamePrimary:
		return color.NRGBA{R: 215, G: 25, B: 32, A: 255}
	case theme.ColorNameFocus:
		return color.NRGBA{R: 239, G: 35, B: 60, A: 255}
	case theme.ColorNameSelection:
		return color.NRGBA{R: 215, G: 25, B: 32, A: 112}
	default:
		return t.base.Color(name, variant)
	}
}

func (t *venzoTheme) Font(style fyne.TextStyle) fyne.Resource {
	return t.base.Font(style)
}

func (t *venzoTheme) Icon(name fyne.ThemeIconName) fyne.Resource {
	return t.base.Icon(name)
}

func (t *venzoTheme) Size(name fyne.ThemeSizeName) float32 {
	return t.base.Size(name)
}
