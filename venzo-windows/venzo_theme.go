package uiservice

import (
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

// venzoTheme keeps native Fyne typography and icons while applying Venzo's
// red accent to both day and night modes.
type venzoTheme struct {
	base fyne.Theme
}

func newVenzoTheme(base fyne.Theme) fyne.Theme {
	return &venzoTheme{base: base}
}

// ApplyVenzoTheme switches the complete application between day and night
// without losing Venzo's branded red controls.
func ApplyVenzoTheme(application fyne.App, dark bool) {
	if application == nil {
		return
	}
	base := theme.LightTheme()
	if dark {
		base = theme.DarkTheme()
	}
	application.Settings().SetTheme(newVenzoTheme(base))
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
