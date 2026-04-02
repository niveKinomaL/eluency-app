import { ReactNode } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useAppTheme } from "../lib/theme";

type AppButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "violet";
  icon?: ReactNode;
  fullWidth?: boolean;
};

export default function AppButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  icon,
  fullWidth = true,
}: AppButtonProps) {
  const theme = useAppTheme();
  const isSecondary = variant === "secondary";
  const isDisabled = disabled || loading;

  const backgroundColor =
    isSecondary
      ? theme.colors.surfaceAlt
      : variant === "violet"
      ? theme.colors.violet
      : theme.colors.primary;

  const textColor = isSecondary ? theme.colors.text : theme.colors.primaryText;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.9}
      style={{
        alignSelf: fullWidth ? "stretch" : "flex-start",
        borderRadius: 999,
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: isDisabled ? theme.colors.borderStrong : backgroundColor,
        borderWidth: 1,
        borderColor: isSecondary ? theme.colors.border : "transparent",
        minHeight: 56,
        shadowColor: isSecondary ? "transparent" : theme.colors.shadow,
        shadowOpacity: isSecondary || isDisabled ? 0 : theme.isDark ? 0.28 : 0.18,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 12 },
        elevation: isSecondary || isDisabled ? 0 : 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : icon ? (
          <View>{icon}</View>
        ) : null}
        <Text
          style={[
            theme.typography.bodyStrong,
            {
              color: textColor,
              fontSize: 14,
              lineHeight: 18,
              textTransform: "uppercase",
              letterSpacing: 1.2,
              textAlign: "center",
              flexShrink: 1,
            },
          ]}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

