import { Platform, TextStyle, useColorScheme, ViewStyle } from "react-native";

type AppColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceGlass: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSoft: string;
  primary: string;
  primarySoft: string;
  primaryText: string;
  success: string;
  successSoft: string;
  violet: string;
  violetSoft: string;
  danger: string;
  dangerSoft: string;
  shadow: string;
};

export type AppTheme = {
  isDark: boolean;
  colors: AppColors;
  typography: {
    display: TextStyle;
    title: TextStyle;
    body: TextStyle;
    bodyStrong: TextStyle;
    label: TextStyle;
    caption: TextStyle;
  };
  cardShadow: ViewStyle;
};

const sharedFontFamily = Platform.select({
  ios: "System",
  android: "Roboto",
  default: "System",
});

const lightColors: AppColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceAlt: "#FFFFFF",
  surfaceGlass: "rgba(255,255,255,0.74)",
  border: "rgba(37,42,46,0.18)",
  borderStrong: "rgba(37,42,46,0.28)",
  text: "#252A2E",
  textMuted: "#252A2E",
  textSoft: "#252A2E",
  primary: "#D45917",
  primarySoft: "rgba(212,89,23,0.12)",
  primaryText: "#FFFFFF",
  success: "#059669",
  successSoft: "rgba(5,150,105,0.12)",
  violet: "#D45917",
  violetSoft: "rgba(212,89,23,0.12)",
  danger: "#DC2626",
  dangerSoft: "rgba(220,38,38,0.12)",
  shadow: "rgba(37,42,46,0.14)",
};

const darkColors: AppColors = {
  background: "#252A2E",
  surface: "#252A2E",
  surfaceAlt: "#252A2E",
  surfaceGlass: "rgba(37,42,46,0.78)",
  border: "rgba(255,255,255,0.20)",
  borderStrong: "rgba(255,255,255,0.30)",
  text: "#FFFFFF",
  textMuted: "#FFFFFF",
  textSoft: "#FFFFFF",
  primary: "#D45917",
  primarySoft: "rgba(212,89,23,0.22)",
  primaryText: "#FFFFFF",
  success: "#34D399",
  successSoft: "rgba(52,211,153,0.18)",
  violet: "#D45917",
  violetSoft: "rgba(212,89,23,0.22)",
  danger: "#F87171",
  dangerSoft: "rgba(248,113,113,0.20)",
  shadow: "rgba(0,0,0,0.55)",
};

export function useAppTheme(): AppTheme {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? darkColors : lightColors;

  return {
    isDark,
    colors,
    typography: {
      display: {
        fontFamily: sharedFontFamily,
        fontSize: 34,
        lineHeight: 40,
        fontWeight: "700",
        color: colors.text,
      },
      title: {
        fontFamily: sharedFontFamily,
        fontSize: 22,
        lineHeight: 28,
        fontWeight: "700",
        color: colors.text,
      },
      body: {
        fontFamily: sharedFontFamily,
        fontSize: 17,
        lineHeight: 24,
        fontWeight: "400",
        color: colors.textMuted,
      },
      bodyStrong: {
        fontFamily: sharedFontFamily,
        fontSize: 17,
        lineHeight: 24,
        fontWeight: "600",
        color: colors.text,
      },
      label: {
        fontFamily: sharedFontFamily,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "700",
        letterSpacing: 1.3,
        textTransform: "uppercase",
        color: colors.textSoft,
      },
      caption: {
        fontFamily: sharedFontFamily,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "500",
        color: colors.textSoft,
      },
    },
    cardShadow: {
      shadowColor: colors.shadow,
      shadowOpacity: isDark ? 0.4 : 0.15,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 8,
    },
  };
}

