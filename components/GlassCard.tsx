import { PropsWithChildren } from "react";
import { Platform, StyleProp, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useAppTheme } from "../lib/theme";

type GlassCardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  padding?: number;
}>;

export default function GlassCard({
  children,
  style,
  contentStyle,
  padding = 20,
}: GlassCardProps) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        {
          overflow: "hidden",
          borderRadius: 28,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceGlass,
        },
        theme.cardShadow,
        style,
      ]}
    >
      {Platform.OS === "ios" ? (
        <BlurView
          intensity={42}
          tint={theme.isDark ? "dark" : "light"}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}
      <View
        style={[
          {
            padding,
            backgroundColor:
              Platform.OS === "android" ? theme.colors.surfaceGlass : "transparent",
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

